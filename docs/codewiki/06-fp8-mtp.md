# FP8 量化 & MTP/Speculative Decode 分析

## Part 1: FP8 量化 (P2)

### 当前状态

MiMo V2 Flash 权重已有 FP8 配置:

```json
{
  "quant_method": "fp8",
  "fmt": "e4m3",
  "activation_scheme": "dynamic",
  "weight_block_size": [128, 128],
  "ignored_layers": ["所有 49 个 o_proj"]
}
```

### 已量化部分

- MoE expert weights (gate/up/down): FP8 e4m3 → **已节省 ~50% 权重内存**
- Attention Q/K/V proj: FP8 e4m3
- Dense FFN: FP8 e4m3

### 未量化部分

- **所有 o_proj** (48 transformer layers + 1 decoder = 49 个): 保持 bf16
  - 原因: 推测是 O projection 对精度更敏感 (将 attention 输出映射回 hidden_size)
  - 每个 o_proj: 8192 × 4096 = 33.6M params × 2B = 67.2 MB
  - 49 个: 49 × 67.2 = 3.29 GB → 如果量化为 FP8 可节省 1.65 GB

### 进一步 FP8 优化空间

#### 1. Activation 量化

当前 `activation_scheme: "dynamic"`:
- 权重已 FP8, 但 activation 仍为 bf16/fp32
- 每次 matmul 需要 FP8 weight × bf16 activation → 混合精度计算
- 如果 activation 也量化为 FP8: matmul 变为 FP8 × FP8 → **2x 计算吞吐** (TPU v6e 支持)

**风险**:
- Dynamic activation quantization 需要逐 tensor 计算 scale, 有额外开销
- 对精度敏感的层 (attention, layernorm) 可能需要保持 bf16

#### 2. KV Cache FP8

当前 KV cache 是 bf16:
- K cache: head_dim=192 × 2B = 384 B/token/head
- V cache: v_head_dim=128 × 2B = 256 B/token/head

如果 KV cache 用 FP8:
- K cache: 192 × 1B = 192 B/token/head → **2x 节省**
- V cache: 128 × 1B = 128 B/token/head → **2x 节省**

Max BS 几乎翻倍! 但需要注意:
- Attention 的 QK^T 精度要求: K cache 在 FP8 下, dot product 精度损失
- V cache FP8 直接影响输出精度
- 需要 ablation 测试不同组合: (K bf16 + V fp8), (K fp8 + V bf16), (both fp8)

#### 3. 权重 Block Size 优化

当前 `weight_block_size: [128, 128]`:
- 每 128×128 block 共享一个 scale factor
- 更细粒度的 block (如 [32, 32]) 可提高精度但增加 scale 存储和计算
- 更粗粒度 (如 [256, 256]) 降低 overhead 但精度更差

### FP8 在不同配置下的影响

| 优化 | 权重节省 | KV cache 节省 | 计算提升 |
|------|---------|-------------|---------|
| 当前 (权重 FP8) | ~50% MoE | 0 | 部分 (FP8×bf16) |
| + o_proj FP8 | +1.65 GB | 0 | 更多 FP8 matmul |
| + KV cache FP8 | 0 | **2x** | 0 |
| + Activation FP8 | 0 | 0 | **~2x matmul** |

### 调研建议

1. **Benchmark FP8 KV cache 精度**: 在 MiMo 上测试 FP8 KV cache 的 perplexity 损失
2. **TPU v6e FP8 matmul 吞吐**: 验证 FP8×FP8 vs FP8×bf16 的实际吞吐差异
3. **o_proj 量化测试**: 对被排除的 o_proj 做精度敏感性测试

---

## Part 2: MTP / Speculative Decode (P1)

### MiMo V2 Flash 的 MTP (Multi-Token Prediction)

MiMo 架构可能包含 MTP heads (多 token 预测头), 用于:
1. **训练**: 作为辅助任务提升模型质量 (类似 DeepSeek-V3)
2. **推理**: 作为 draft model 用于 speculative decoding

### Speculative Decoding 原理

```
传统 decode: 每步生成 1 token, 序列化
  step 1: model(x) → token_1
  step 2: model(x + token_1) → token_2
  step 3: model(x + token_1 + token_2) → token_3
  ...

Speculative decode:
  step 1: draft_model(x) → [guess_1, guess_2, guess_3, ...]  (快速)
  step 2: main_model(x + [guess_1, guess_2, guess_3]) → verify  (并行)
  step 3: accept correct prefix of guesses

  如果 draft 准确率高, 每步生成 3-5 tokens, 吞吐提升 3-5x
```

### MiMo 架构兼容性分析

#### MTP Head 作为 Draft Model

如果 MiMo 有 MTP head:
```
Main model forward → hidden_states → MTP head → [token_1, token_2, ..., token_k]
                                      ↓
                              作为 draft tokens
                                      ↓
                    Main model verify (prefill mode, 并行验证)
```

优点:
- **零额外参数**: MTP head 很小, 复用 main model 的 hidden states
- **高准确率**: MTP head 和 main model 联合训练, 预测准确率高
- **无额外 KV cache**: draft 阶段不需要额外 KV cache (复用 main model 的)

#### 潜在挑战

1. **MoE 路由一致性**: Draft tokens 的 MoE routing 可能与 verify 不同
   - MTP head 预测的 token 未经过 MoE routing
   - Verify 时需要完整 forward (包括 MoE), 可能改变 routing 决策

2. **KV cache 管理**: Draft tokens 生成的 KV 需要在被拒绝时回滚
   - Paged KV cache 需要支持 speculative token 的分配和释放
   - GA 层的 KV cache 回滚涉及 9 层 × draft_length 个 tokens

3. **SWA 层的特殊处理**:
   - SWA window=128 极小
   - Draft tokens 如果超出 window, 需要考虑 SWA 的 sliding 逻辑
   - 实际上 draft_length 一般 < 10, 远小于 128, 应该没问题

4. **Batch 化 speculative decode**:
   - 不同序列的 draft acceptance rate 不同
   - 需要 ragged batch 支持 (已有)
   - 但增加了 scheduler 复杂度

### Self-Speculative Decoding

无需 MTP head 的替代方案:

```
方案 1: Layer Skipping
  Draft: 只用前 12/48 层 (跳过 36 层)
  Verify: 全 48 层

方案 2: Expert Subset
  Draft: 每层只用 top-2 experts (而非 top-8)
  Verify: 全 top-8 experts

方案 3: SWA-only Draft
  Draft: 只用 39 个 SWA 层 (跳过 9 个 GA 层)
  Verify: 全 48 层
```

方案 3 特别适合 MiMo: SWA 层计算量约为全模型的 81% (39/48), 但跳过 GA 层后质量损失可能较大。

### 与 DP Attention 的协同

Speculative decode + DP attention:
```
DP Group 0: decode seq_0-15, draft 4 tokens each
  → verify: prefill mode, 4 draft tokens × 16 seqs = 64 tokens
  → batch verify 效率高

DP Group 1-7: 独立做相同的事

好处: 每个 DP group 的 verify batch 更小, 减少 latency
坏处: MoE all-to-all 仍需全设备参与
```

### 调研建议

1. **确认 MTP head 存在**: 检查 MiMo V2 Flash 权重中是否有 MTP head
2. **MTP accuracy 测试**: 如果有 MTP head, 测试 draft 准确率
3. **KV cache rollback**: 评估 paged KV cache 的回滚效率
4. **Self-speculative benchmark**: 测试 layer skipping 和 expert subset 方案
5. **端到端 throughput**: 计算 speculative decode 的期望吞吐提升

### 估算收益

假设 MTP draft length=4, acceptance rate=70%:
```
平均每次 verify:
  accepted = 0.7^0 + 0.7^1 + 0.7^2 + 0.7^3 ≈ 2.3 tokens
  (加上 verify 后的 1 token = 3.3 tokens per step)

Speedup ≈ 3.3x / (1 + verify_overhead)
  verify_overhead ≈ 0.3x (4 token prefill vs 1 token decode)

Net speedup ≈ 3.3 / 1.3 ≈ 2.5x per-request latency
```

对于 MiMo 的 MoE 架构, verify 的 overhead 可能更大 (MoE all-to-all), 实际 speedup 可能 **1.5-2.5x**。
