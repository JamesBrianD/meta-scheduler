# 两天调研计划

## 总览

```
Day 1 (量化分析 + Kernel Baseline):
  上午: KV cache 空间验证 + 权重内存实测
  下午: Attention kernel profiling + MoE kernel profiling

Day 2 (方案验证 + 整合):
  上午: DP Attention 可行性验证 + Fused MoE 评估
  下午: MTP 调研 + 报告整合
```

---

## Day 1: 量化分析 + Kernel Baseline

### 上午: KV Cache & 权重内存实测 (4h)

#### Task 1.1: 验证权重内存计算 (1h)

```bash
# 实测当前 TP=16 下每设备权重内存
# 对比理论计算值 (见 02-kv-cache-space-analysis.md)

1. 启动 TP=16 配置, 记录 HBM 使用 (weights only, 无 KV cache)
2. 与理论值对比:
   - MoE FP8: 18.9 GB
   - Attention bf16: 560 MB
   - 总计: ~19.7 GB
3. 如有差异, 分析原因 (optimizer states? temp buffers?)
```

**输出**: 每设备权重内存实测值 + 与理论差异分析

#### Task 1.2: KV Cache 实际开销测量 (1.5h)

```bash
# 测量不同 seq_len 下 per-sequence KV cache 实际占用

1. 固定 BS=1, 分别跑 seq_len = 128, 1K, 4K, 16K
2. 记录每个 seq_len 的 HBM 增量 = KV cache 占用
3. 与理论计算对比:
   - TP=16 理论 (with padding): 64 MB (4K), 234 MB (16K)
   - 理想 (no padding): 120 MB (4K), 403 MB (16K) [全量]
4. 计算实际 padding overhead 倍数
```

**输出**: KV cache 实测值表格, 确认 padding overhead 倍数

#### Task 1.3: 可用 KV 空间 & Max BS 验证 (1.5h)

```bash
# 实测当前配置下的 max BS

1. TP=16, 固定 seq_len=4K, 逐步增大 BS 直到 OOM
   → 记录 max BS 和 HBM 使用曲线
2. 与理论 max BS 对比 (理论: ~172)
3. 如果差异 > 10%, 分析额外开销来源:
   - Activation memory
   - Communication buffers
   - Page table overhead
   - System reserved memory
```

**输出**: 实测 max BS, HBM breakdown pie chart

---

### 下午: Kernel Profiling Baseline (4h)

#### Task 1.4: Attention Kernel Profiling (2h)

```bash
# 建立 attention kernel 性能 baseline

1. 单层 GA attention profiling:
   - Prefill: BS=32, seq_len=4K
   - Decode: BS=128, seq_len=4K (cached)
   - 记录: total time, compute time, memory time, padding time

2. 单层 SWA attention profiling:
   - Prefill: BS=32, seq_len=128 (window)
   - Decode: BS=128, seq_len=128 (window)
   - 记录: total time, compute time, memory time

3. 理论上限计算:
   GA prefill (BS=32, seq=4K):
     FLOPs = 32 × 4096 × 4096 × 64 × 2 = 理论 compute time
     Bytes = Q + K + V + O + KV cache reads = 理论 memory time
     Roofline = max(compute, memory)

4. Gap 分析:
   actual / theoretical → efficiency %
   识别瓶颈: compute-bound or memory-bound
```

**输出**: Attention roofline analysis, 瓶颈识别

#### Task 1.5: MoE Kernel Profiling (2h)

```bash
# 建立 MoE kernel 性能 baseline

1. 单层 MoE profiling (EP=16):
   - BS=32 tokens, top-8 routing
   - 分解: router + all-to-all dispatch + expert FFN + all-to-all combine

2. Expert 负载分布统计:
   - 跑 100 个 batch, 收集每个 expert 的 token 数
   - 计算 max/mean/std, 画负载分布直方图
   - 识别热门 expert

3. All-to-All 通信时间:
   - 隔离 all-to-all 的时间占比
   - 对比 compute vs communication

4. Barrier 等待时间:
   - 逐 local_expert 的处理时间
   - Barrier 空等时间占比
```

**输出**: MoE 时间分解, expert 负载分布, all-to-all overhead

---

## Day 2: 方案验证 + 整合

### 上午: DP Attention + Fused MoE 验证 (4h)

#### Task 2.1: DP Attention 通信拓扑验证 (2h)

```bash
# 验证 DP=8, TP=2 配置的可行性

1. 集合通信测试:
   - TP=2 AllReduce bandwidth (组内 2 设备)
   - EP=16 All-to-All bandwidth (全 16 设备)
   - 对比 TP=16 AllReduce baseline

2. 简化 forward 测试:
   - 只跑 attention 部分, DP=8 TP=2
   - 验证 KV cache 独立管理正确性
   - 验证 output 一致性 (vs TP=16 参考)

3. 权重分布验证:
   - TP=2 下 attention 权重分割
   - EP=16 不变
   - 确认每设备 HBM 使用: ~24.9 GB 权重
   - 确认可用 KV 空间: ~5.6 GB
```

**输出**: DP attention 可行性确认, 通信 benchmark, 每设备 HBM breakdown

#### Task 2.2: Fused MoE 评估 (2h)

```bash
# 评估 Fused MoE 的性能提升空间

1. 检查现有 Fused MoE kernel 实现:
   - SGLang/vLLM 是否已有 Pallas Fused MoE kernel?
   - 如果有: 直接 benchmark
   - 如果无: 评估移植工作量

2. Micro-benchmark (如果有现成实现):
   - 相同 input, EPMoE vs Fused MoE
   - BS=1, 8, 32, 128, 512
   - 记录 compute time + memory usage

3. 如果没有现成实现, 理论估算:
   - 消除 scatter/gather 的时间
   - 消除 barrier 的时间
   - Gate+Up fusion 的带宽节省
   - 得出预估 speedup range
```

**输出**: Fused MoE 可用性评估 + 性能对比/估算

---

### 下午: MTP 调研 + 报告整合 (4h)

#### Task 2.3: MTP / Speculative Decode 调研 (2h)

```bash
# 调研 MiMo V2 Flash 的 MTP 兼容性

1. 检查模型权重:
   - MiMo V2 Flash 是否包含 MTP head 权重?
   - 如果有: 分析 MTP head 结构 (层数, 维度, 预测 token 数)

2. 现有框架支持:
   - SGLang 是否支持 speculative decode?
   - 如果支持: 需要什么适配?
   - 重点: KV cache rollback, ragged batch 兼容性

3. 替代方案评估:
   - Self-speculative (layer skipping): 评估可行性
   - Eagle/Medusa 类外部 draft: 评估工作量

4. 与 DP Attention 兼容性:
   - Speculative decode 在 DP attention 下的行为
   - Draft/verify 的 batch 如何分配到 DP groups
```

**输出**: MTP 可行性报告, 推荐方案

#### Task 2.4: 综合报告整合 (2h)

```bash
# 汇总所有发现, 产出最终优化路线图

1. 优化收益排序 (基于实测/验证数据):
   | 优化项 | 预期收益 | 实现难度 | 优先级 |
   |--------|---------|---------|--------|
   | KV cache padding fix | ... | ... | ... |
   | DP Attention | ... | ... | ... |
   | Fused MoE | ... | ... | ... |
   | MTP/Spec Decode | ... | ... | ... |
   | FP8 KV cache | ... | ... | ... |

2. 实施时间线:
   - Week 1: ...
   - Week 2: ...
   - Month 1: ...

3. 风险与依赖:
   - 哪些优化互相依赖?
   - 哪些可以并行开发?
   - 哪些需要上游 (SGLang) 支持?

4. 更新 codewiki 中的估算值为实测值
```

**输出**: 最终优化路线图文档

---

## 可交付物清单

| # | 交付物 | 产出时间 |
|---|--------|---------|
| 1 | HBM breakdown (权重 + KV cache) | Day 1 上午 |
| 2 | 实测 max BS + padding overhead 确认 | Day 1 上午 |
| 3 | Attention kernel roofline analysis | Day 1 下午 |
| 4 | MoE profiling + expert 负载分布 | Day 1 下午 |
| 5 | DP Attention 可行性确认 | Day 2 上午 |
| 6 | Fused MoE 评估结果 | Day 2 上午 |
| 7 | MTP 可行性报告 | Day 2 下午 |
| 8 | **综合优化路线图** | Day 2 下午 |

---

## 优先级决策框架

```
高价值, 低难度 → 立即做:
  ✓ KV cache padding fix (已有方案)
  ✓ Attention kernel baseline

高价值, 高难度 → 先验证再计划:
  → DP Attention (Day 2 验证)
  → Fused MoE (Day 2 评估)

中价值 → 排入后续:
  → MTP/Speculative Decode
  → Expert Replication

低优先级 → 长期规划:
  → FP8 KV cache
  → FP8 Activation
```
