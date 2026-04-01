# KV Cache Padding 问题详解

## 问题概述

当前实现中存在三层 padding，导致 KV cache 实际占用远超有效值。在 TP=16 配置下，KV cache 占用约为理论值的 **8-10x**。

## 问题 1: Q/K/V Dim Padding (head_dim 192 → 256)

### 根因

Pallas flash attention kernel 要求 dim size 是 128 的整数倍。MiMo V2 Flash 的 `head_dim = 192`，不满足此要求。

### 影响

- **Prefill**: 引入 padding 操作，占 prefill 时间的 ~7%
- **KV Cache**: K cache 从 192 维膨胀到 256 维
  - 每 token 每 head K cache: 192 × 2B = 384B → 256 × 2B = 512B (1.33x)
  - V cache: 128 维，已是 128 整数倍，**无需 padding**
  - 综合: (256+128)/(192+128) = 384/320 = **1.2x 开销**

### 解决方案

在 model weight load 时对 `q_proj`, `k_proj` 权重做 padding，使计算得到的 Q, K 的 head_dim = 256。

**优点**: 一次性 padding，消除运行时 padding 开销
**注意**: 只需 padding K 维度，V 维度 (128) 已对齐

### 预期收益

- Prefill 性能提升 ~7% (消除运行时 padding)
- KV cache 空间节省 ~17% (256→192 on K dim only)
- Decode 性能提升来自 KV cache 读取量减少

## 问题 2: Cache Heads Padding (KV heads → 2 minimum)

### 根因

Pallas kernel 使用 `bitcast(uint32)` + strided load 一次读取多个低精度值。对于 bf16，uint32 一次读取 2 个值，因此要求 KV heads 数量最少为 2。

### 影响 (以 TP=16 为例)

| Attention 类型 | 实际 KV heads | Per device (TP=16) | 需要 pad 到 | Head 开销 |
|---------------|-------------|-------------------|-----------|----------|
| GA (Full) | 4 | 4/16 = 0.25 → 1 | 2 | 8x |
| SWA | 8 | 8/16 = 0.5 → 1 | 2 | 4x |

这是 TP=16 下 KV cache 膨胀的**最大因素**。

### 解决方案

**方案 A: DP Attention (推荐)**
使用 TP=2 或 TP=4，使 per-device KV heads 自然满足 ≥ 2：

| 配置 | GA heads/device | SWA heads/device | GA 需 pad? | SWA 需 pad? |
|------|----------------|-----------------|-----------|------------|
| TP=16 | 0.25→2 | 0.5→2 | 是 (8x) | 是 (4x) |
| TP=4 | 1 | 2 | 是 (2x) | 否 |
| TP=2 | 2 | 4 | **否** | **否** |

**TP=2 是最优选择**: GA 4 heads / 2 = 2 (刚好满足)，SWA 8 heads / 2 = 4 (富余)

**方案 B: bf16 原生 load**
修改 Pallas kernel，用 bf16 load 替代 uint32 bitcast：
- 优点: 消除 heads ≥ 2 的约束
- 缺点: 可能有性能损耗 (待 benchmark)
- 适用: 必须使用高 TP 的场景

## 问题 3: Cache Dim Padding Bug (运行时全量 padding)

### 根因

这是一个 **Bug**，而非设计限制。

### 代码路径

```
1. Flash attention kernel 内部:
   k_cache_arg shape = [pages, page_size, 2, 256]  (KV pool 已 aligned 到 256)

2. 传给 ragged_paged_attention 的 k_cache = k_cache_arg
   k_cache.shape[-1] = 256

3. 进入 ragged_paged_attention_split_kv (line 1136):
   prepare_updated_kv_cache(updated_k, actual_num_kv_heads=2, k_cache.shape[-1]=256)

4. prepare_updated_kv_cache 做 [:, :2, :256]:
   dim 方向不 trim (256 == 256) → 返回 [total_tokens, 2, 256]

5. Flash attention 完成后:
   将 K cache 从 256 dim 截断回 192 dim  ← 不必要的操作

6. forward 结束后:
   SplitMHATokenToKVPool.replace_kv_buffer 将 256 dim 替换为 192 dim
   → 每次 forward 都在做 full KV cache 的 reshape  ← 严重性能问题
```

### 影响

- **每次 forward 都 reshape 整个 KV cache**: O(batch_size × seq_len × kv_heads × dim) 的拷贝
- **激活内存激增**: 需要同时存在 256-dim 和 192-dim 两份 KV cache
- **Decode 性能**: Profiling 显示 decode 阶段有大量时间花在 KV cache 操作上

### 解决方案

从始至终保持 KV cache 为 256 dim (权重 load 时 padding)，消除运行时 dim 转换。

## 综合影响量化

### TP=16 下 KV cache 开销分解

| Padding 来源 | GA 开销倍数 | SWA 开销倍数 |
|-------------|-----------|-------------|
| Head replication (TP sharding) | 4x | 2x |
| Head padding (uint32 min=2) | 2x | 2x |
| Dim padding (192→256, K only) | 1.2x | 1.2x |
| **综合** | **9.6x** | **4.8x** |

### 修复预期收益

| 修复项 | Prefill 提升 | Decode 提升 | KV cache 节省 |
|-------|------------|------------|-------------|
| Dim padding (权重层 padding) | ~7% | ~11% | ~17% (K dim) |
| Cache dim bug fix | 显著 | **~1.5x** | 消除临时副本 |
| DP Attention (TP=2) | - | - | 消除 head 开销 |
| **全部修复** | **~11%** | **~1.5x** | **~80% 节省** |
