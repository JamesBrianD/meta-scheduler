# MoE Kernel 优化分析

## MiMo V2 Flash MoE 配置

| 参数 | 值 |
|------|-----|
| n_routed_experts | 256 |
| num_experts_per_tok | 8 (top-8) |
| moe_intermediate_size | 2048 |
| hidden_size | 4096 |
| MoE 层数 | 47 (Layer 1-47) |
| scoring_func | sigmoid |
| topk_method | noaux_tc |
| n_group / topk_group | 1 / 1 (无分组) |

## 当前实现: EPMoE + 手动 GMM

### 架构

```
Token (4096) → Router → Top-8 expert IDs + weights
                           ↓
                    All-to-All dispatch (发送 token 到对应 expert 所在设备)
                           ↓
                    Local expert FFN (每设备 16 experts, EP=16)
                           ↓
                    All-to-All combine (收回结果)
                           ↓
                    Weighted sum → output (4096)
```

### 开发分支修改: 权重布局翻转

```python
# 原始: [E, k, n] = [16, 4096, 2048] (gate/up) / [16, 2048, 4096] (down)
# 修改: [E, n, k] = [16, 2048, 4096] (gate/up) / [16, 4096, 2048] (down)
```

GMM Pallas kernel 的 RHS shape、dot product、block spec 全部重写以适配新布局。

**需要验证**: 翻转后的布局是否在 TPU v6e 上更优 (可能更适合 MXU 的内存访问模式)。

## 优化方向 1: Fused MoE Kernel

### 当前 (分步 EPMoE)

```
步骤 1: Router 计算 (sigmoid + topk)           — 小量计算
步骤 2: Token → expert scatter                  — 内存操作
步骤 3: For each local expert:                  — 循环, 有 barrier
           barrier_sync()
           gate_up = x @ W_gate_up              — GMM
           activated = silu(gate) * up           — element-wise
           down = activated @ W_down             — GMM
步骤 4: Expert → token gather                   — 内存操作
步骤 5: Weighted sum                            — 小量计算
```

每个 local expert 间有 barrier, 总共 `local_num_experts` 个 barrier。

### Fused MoE

```
步骤 1: Router (不变)
步骤 2: fused_moe_kernel(
           tokens,           // [total_tokens, 4096]
           expert_ids,       // [total_tokens, 8]
           expert_weights,   // [total_tokens, 8]
           w_gate_up,        // [16, 2*2048, 4096] (fused gate+up)
           w_down,           // [16, 4096, 2048]
         ) → output          // [total_tokens, 4096]
```

优势:
1. **消除 scatter/gather**: token 不需要物理移动, kernel 内部通过 index 访问
2. **消除 barrier**: 不再逐 expert 串行, 而是按 token 并行
3. **Gate+Up 融合**: 一次 matmul 得到 gate 和 up, 减少一次权重读取
4. **更好的流水线**: 计算和内存访问可以更好地 overlap

### 预期收益估算

单层 MoE compute (per device, EP=16):
```
每个 token 路由到 8 experts, 但 EP=16 下平均每 device 处理:
  tokens_per_device ≈ total_tokens × 8 / 16 = total_tokens / 2

Per token per expert:
  gate_up: 4096 × 4096 × 2 FLOPs = 33.5M FLOPs  (gate+up fused = 4096×2*2048)
  down:    2048 × 4096 × 2 FLOPs = 16.8M FLOPs
  Total:   50.3M FLOPs/token/expert

Per device total: tokens_per_device × 50.3M FLOPs
```

TPU v6e MXU 算力: ~197 TFLOPS (bf16)

For batch=128 tokens:
```
分步 EPMoE (16 experts, barrier):
  tokens_per_device ≈ 64
  每 expert 平均 4 tokens
  16 barriers × compute(4 tokens each)
  → MXU 利用率低 (小 batch per expert)

Fused MoE:
  一次处理 64 tokens × 各自的 expert
  → 更大的 batch, 更高 MXU 利用率
```

**保守估计**: Fused MoE 在 decode 场景 (小 batch) 可提升 **30-50%**, 在 prefill 场景 (大 batch) 提升 **10-20%**。

## 优化方向 2: Expert Replication (docs/1.md 方案)

> 详见 docs/1.md 的完整分析

### 核心思路

将热门 expert 复制到多个设备, 减少单点瓶颈:

```
当前 EP=16, 每 device 1 expert (256/16=16, 但 barrier 逻辑是逐个处理):
  热门 expert: dyn_sz=2048, 独占一个 barrier 轮次
  全局 MXU 利用率: ~9.7%

2x Replication (每 device 2 experts):
  热门 expert 的两个 replica 在同一 barrier 轮次并行处理
  每个 replica: dyn_sz=1024
  全局时间: 1024 + small (vs 之前的 2048)
```

### 关键设计: Replica 布局

两个 replica 必须在同一个 `local_e_id` 位置 (同一 barrier 轮次), 才能并行:

```
Rank 0:   local_e_id=0 → expert_0_replica_A (1024 tokens)
Rank 128: local_e_id=0 → expert_0_replica_B (1024 tokens)

Barrier 0: 两个 replica 同时处理 → max_load = 1024 (vs 之前 2048)
```

### 代价

| 指标 | 无 replication | 2x replication |
|------|-------------|---------------|
| 权重/device | 84 MB | 168 MB (+84 MB) |
| Barriers/step | 1 | 2 |
| 瓶颈负载 | X | X/2 |
| 额外逻辑 | 无 | replica-aware routing |

## 优化方向 3: All-to-All 通信优化

### 当前

每层 MoE 需要 2 次 All-to-All:
1. Dispatch: 发送 token embeddings 到 expert 所在设备
2. Combine: 收回 expert 输出

通信量 (per layer):
```
Dispatch: total_tokens × 8 × 4096 × 2B = total_tokens × 65,536 B
  (每 token 发送到 8 个 expert, 每份 4096 × 2B = 8KB)

Combine: 相同量

For batch=128 tokens: 2 × 128 × 65,536 = 16.8 MB per layer
47 layers: 47 × 16.8 MB = 790 MB total
```

### 优化方向

1. **计算-通信 overlap**: 在处理当前层 MoE 的同时, 发送下一层的 dispatch
2. **FP8 通信**: dispatch/combine 的 token 用 FP8 而非 bf16, 通信量减半
3. **Token dropping**: 对超载 expert 做 token dropping, 减少通信量
4. **Expert locality**: 尽量将同一请求的 tokens 路由到相近的 experts, 减少跨设备通信

## 与 DP Attention 的交互

DP Attention (DP=8, TP=2) 下 MoE 的变化:

```
Before (TP=16):
  16 设备, 每设备 16 experts
  All-to-All: 16 × 16 矩阵

After (DP=8, TP=2):
  仍然 EP=16, 每设备 16 experts
  All-to-All: 16 × 16 (不变)

  但 token 分布变化:
  - 每个 DP group 只处理 BS/8 的 tokens
  - All-to-All 的 token 总量不变 (只是来源分散)
  - 可能导致 expert 负载更不均衡 (因为 token 子集更小)
```

需要验证: DP=8 是否影响 MoE 负载均衡。

## Benchmark 计划

```
1. 当前 EPMoE kernel profiling:
   - 每层 MoE 的 compute time vs all-to-all time
   - Expert 负载分布 (max/mean/min dyn_sz)
   - Barrier 等待时间占比

2. Fused MoE benchmark:
   - 相同 input, Fused vs EPMoE 性能对比
   - 不同 batch size (1, 8, 32, 128, 512) 下的差异
   - MXU 利用率对比

3. Expert replication benchmark:
   - 模拟热门 expert 场景
   - 1x vs 2x replication 的总 MoE 时间
   - 权重 overhead 验证
```

## 优先级

| 优化 | 优先级 | 难度 | 预期收益 |
|------|--------|------|---------|
| Fused MoE kernel | P0 | 中 | Decode 30-50%, Prefill 10-20% |
| Expert replication | P1 | 中 | 不均衡场景 MXU 2x |
| 计算通信 overlap | P1 | 高 | 端到端 10-15% |
| FP8 通信 | P2 | 低 | 通信时间 ~2x |
