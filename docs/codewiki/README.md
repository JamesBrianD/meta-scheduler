# MiMo V2 Flash 性能优化 Codewiki

> TPU v6e 上 MiMo V2 Flash (309B MoE, 15B active) 的推理性能优化分析

## 目录

### 基础信息
- [00-architecture.md](00-architecture.md) — 模型架构速查 (参数, 层配置, 权重估算)

### 已确认问题
- [01-kv-cache-padding-bug.md](01-kv-cache-padding-bug.md) — 三层 padding 问题详解 (dim/head/cache bug)
- [02-kv-cache-space-analysis.md](02-kv-cache-space-analysis.md) — **KV Cache 空间计算 & Max BS 推演** (5 种 TP/DP 配置对比)

### 核心优化方向
- [03-dp-attention.md](03-dp-attention.md) — DP Attention 适配 (4-6x 吞吐提升, 实现路线)
- [04-attention-kernel.md](04-attention-kernel.md) — Attention Kernel 优化路线 (Baseline → Split KV → Fused)
- [05-moe-optimization.md](05-moe-optimization.md) — MoE Kernel 优化 (Fused MoE, Expert Replication, All-to-All)

### 延伸优化
- [06-fp8-mtp.md](06-fp8-mtp.md) — FP8 量化 (KV cache/activation) & MTP/Speculative Decode
- [07-other-issues.md](07-other-issues.md) — 13 个潜在问题 (Allocator bug, RoPE, Sink Bias, 负载均衡...)

### 计划
- [08-two-day-plan.md](08-two-day-plan.md) — 两天调研计划 (任务分解, 交付物清单)

### 参考
- [../1.md](../1.md) — Expert Replication 方案详细分析 (已有)

## 快速参考

### 优化收益预期排序

| # | 优化项 | 预期收益 | 优先级 | 难度 |
|---|--------|---------|--------|------|
| 1 | KV Cache Padding Fix | Decode 1.5x, Prefill +11% | P0 | 低 |
| 2 | DP Attention (DP=8, TP=2) | Max BS 4-6x | P0 | 中-高 |
| 3 | Fused MoE Kernel | Decode 30-50% | P0 | 中 |
| 4 | MTP / Speculative Decode | 延迟 1.5-2.5x | P1 | 高 |
| 5 | Attention Kernel (Split/Fused KV) | Decode 20-30% | P1 | 中 |
| 6 | Expert Replication | 不均衡场景 MXU 2x | P1 | 中 |
| 7 | FP8 KV Cache | Max BS 2x | P2 | 中 |
| 8 | FP8 Activation | 计算吞吐 2x | P2 | 高 |

### MiMo V2 Flash 关键数字

```
Hidden:     4096          Layers:     48 (9 GA + 39 SWA)
GA KV:      4 heads       SWA KV:     8 heads
K dim:      192           V dim:      128
Experts:    256 (top-8)   Expert FFN: 2048
SWA Window: 128 tokens    Max Seq:    262144 (256K)
Params:     309B total    Active:     15B
```
