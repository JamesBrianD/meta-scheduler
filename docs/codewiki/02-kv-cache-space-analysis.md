# KV Cache 空间计算与 Max Batch Size 推演

## 计算基础

### 理想 KV Cache 大小 (无 padding, 无 replication)

**Per token per layer (bf16):**

| Attention | K cache | V cache | 合计 |
|-----------|---------|---------|------|
| GA (4 KV heads) | 4 × 192 × 2B = 1,536 B | 4 × 128 × 2B = 1,024 B | 2,560 B |
| SWA (8 KV heads) | 8 × 192 × 2B = 3,072 B | 8 × 128 × 2B = 2,048 B | 5,120 B |

**Per sequence (全量, 无 TP 分割):**

| 输入长度 | GA (9 layers × L tokens) | SWA (39 layers × 128 tokens) | 合计 |
|---------|------------------------|----------------------------|------|
| L=4K | 9 × 2,560 × 4,096 = 94.4 MB | 39 × 5,120 × 128 = 25.6 MB | **120 MB** |
| L=16K | 9 × 2,560 × 16,384 = 377.5 MB | 25.6 MB (固定) | **403 MB** |
| L=128K | 9 × 2,560 × 131,072 = 3,020 MB | 25.6 MB | **3,046 MB** |

> SWA 的 KV cache 是固定的 ~25.6 MB/序列 (因为 sliding_window=128)，GA 线性增长

---

## 权重内存估算 (FP8 MoE + bf16 Attention)

### 各配置下每设备权重内存

| 组件 | 计算公式 | TP=16 | TP=4 | TP=2 |
|------|---------|-------|------|------|
| Attention (bf16) | 4,484M / TP × 2B | 560 MB | 2,242 MB | 4,484 MB |
| Dense FFN (bf16) | 201M / TP × 2B | 25 MB | 100 MB | 201 MB |
| Embeddings (bf16) | 625M / TP × 2B | 78 MB | 312 MB | 625 MB |
| LM Head (bf16) | 625M / TP × 2B | 78 MB | 312 MB | 625 MB |
| **非MoE 小计** | | **741 MB** | **2,966 MB** | **5,935 MB** |

MoE 权重按 EP 分布 (与 TP 无关):

| EP | Experts/device | FP8 权重/device |
|----|---------------|----------------|
| EP=16 (16卡) | 16 | 47 × 16 × 25.2M × 1B = **18.9 GB** |
| EP=32 (32卡) | 8 | 47 × 8 × 25.2M × 1B = **9.5 GB** |

Router 权重 (replicated): 47 × 4096 × 256 × 2B ≈ 99 MB

---

## 各配置可用 KV Cache 空间

> TPU v6e HBM = 32 GB/chip, 系统开销预留 1.5 GB

### 16 卡配置

| 配置 | 非MoE 权重 | MoE (EP=16) | 总权重 | 可用 KV 空间 |
|------|-----------|------------|--------|-------------|
| **a. TP=16** | 741 MB | 18.9 GB | 19.7 GB | **10.8 GB** |
| **b. DP=8, TP=2** | 5,935 MB | 18.9 GB | 24.9 GB | **5.6 GB** |
| **c. DP=4, TP=4** | 2,966 MB | 18.9 GB | 21.9 GB | **8.6 GB** |

### 32 卡配置

| 配置 | 非MoE 权重 | MoE (EP=32) | 总权重 | 可用 KV 空间 |
|------|-----------|------------|--------|-------------|
| **d. DP=16, TP=2** | 5,935 MB | 9.5 GB | 15.5 GB | **15.0 GB** |
| **e. DP=8, TP=4** | 2,966 MB | 9.5 GB | 12.5 GB | **18.0 GB** |

---

## 每设备 KV Cache 大小 (修复 padding 后)

### Per sequence per device (理想, 无 padding)

| 配置 | GA heads/dev | SWA heads/dev | L=4K KV/seq | L=16K KV/seq |
|------|-------------|--------------|------------|-------------|
| TP=16 (min 2 heads*) | 2 | 2 | 53.3 MB | 194.8 MB |
| TP=4 (GA needs fix*) | 1→2* | 2 | 53.3 MB | 194.8 MB |
| TP=2 (完美) | 2 | 4 | 59.4 MB | 200.9 MB |
| TP=4 + uint32 fix | 1 | 2 | 29.7 MB | 100.5 MB |

> *TP=16/4: GA 的 4 heads 不够分，需要 head replication + uint32 padding to 2

详细计算 (TP=2, 理想情况):
```
GA per device per layer per token:
  K: 2 heads × 192 dim × 2B = 768 B
  V: 2 heads × 128 dim × 2B = 512 B
  合计: 1,280 B

SWA per device per layer per token:
  K: 4 heads × 192 dim × 2B = 1,536 B
  V: 4 heads × 128 dim × 2B = 1,024 B
  合计: 2,560 B

Per sequence (L tokens):
  GA: 9 layers × 1,280 B × L = 11,520 × L
  SWA: 39 layers × 2,560 B × 128 = 12,779,520 B ≈ 12.2 MB (固定)
```

---

## Max Batch Size 推演

### 公式

```
Max BS per device = floor(可用 KV 空间 / 每序列 KV)
Total Max BS = Max BS per device × DP 并行度
```

### 结果汇总

#### 输入 4K tokens

| 配置 | 可用空间 | KV/seq/dev | BS/dev | DP | **Total Max BS** | vs 基线 |
|------|---------|-----------|--------|-----|-----------------|---------|
| a. 16卡 TP=16 (当前+padding) | 10.8 GB | 64 MB | 172 | 1 | **172** | 1.0x |
| a'. 16卡 TP=16 (fix padding) | 10.8 GB | 53 MB | 208 | 1 | **208** | 1.2x |
| b. 16卡 DP=8, TP=2 | 5.6 GB | 59 MB | 97 | 8 | **776** | **4.5x** |
| c. 16卡 DP=4, TP=4 | 8.6 GB | 53 MB | 165 | 4 | **660** | 3.8x |
| c'. 16卡 DP=4, TP=4 +uint32 fix | 8.6 GB | 30 MB | 293 | 4 | **1,172** | **6.8x** |
| d. 32卡 DP=16, TP=2 | 15.0 GB | 59 MB | 260 | 16 | **4,160** | **24.2x** |
| e. 32卡 DP=8, TP=4 +uint32 fix | 18.0 GB | 30 MB | 614 | 8 | **4,912** | **28.6x** |

#### 输入 16K tokens

| 配置 | 可用空间 | KV/seq/dev | BS/dev | DP | **Total Max BS** | vs 基线 |
|------|---------|-----------|--------|-----|-----------------|---------|
| a. 16卡 TP=16 (当前+padding) | 10.8 GB | 234 MB | 47 | 1 | **47** | 1.0x |
| a'. 16卡 TP=16 (fix padding) | 10.8 GB | 195 MB | 56 | 1 | **56** | 1.2x |
| b. 16卡 DP=8, TP=2 | 5.6 GB | 201 MB | 28 | 8 | **224** | **4.8x** |
| c. 16卡 DP=4, TP=4 | 8.6 GB | 195 MB | 45 | 4 | **180** | 3.8x |
| c'. 16卡 DP=4, TP=4 +uint32 fix | 8.6 GB | 101 MB | 87 | 4 | **348** | **7.4x** |
| d. 32卡 DP=16, TP=2 | 15.0 GB | 201 MB | 76 | 16 | **1,216** | **25.9x** |
| e. 32卡 DP=8, TP=4 +uint32 fix | 18.0 GB | 101 MB | 182 | 8 | **1,456** | **31.0x** |

---

## 关键洞察

### 1. DP Attention 是最大杠杆

单纯修 padding 只有 ~1.2x，而 DP=8 + TP=2 带来 **4.5-4.8x** 的 max BS 提升。原因:
- 消除 head replication (8x → 1x on GA)
- 消除 uint32 head padding (2x → 1x)
- Batch 分散到 8 个 DP group，每个设备只需存 1/8 的 KV

### 2. TP=2 是 MiMo V2 Flash 的最优 TP

- GA: 4 heads / 2 = 2 heads/device → 刚好满足 uint32 最低要求
- SWA: 8 heads / 2 = 4 heads/device → 富余
- 无需任何 head replication 或 padding

### 3. 32 卡的巨大优势

- EP=32 vs EP=16: MoE 权重减半 (18.9GB → 9.5GB)
- 更多 HBM 留给 KV cache
- DP 并行度更高，线性提升总 batch size

### 4. uint32 fix 在 TP=4 下非常有价值

如果能实现 bf16 native load:
- TP=4 GA: 1 head/device (无需 pad 到 2) → 额外 2x KV 节省
- 使得 DP=4/TP=4 成为可能的中间方案 (平衡 attention 和 MoE 通信)

### 5. SWA 的 128-token window 是天然优势

SWA KV cache 只有 12-26 MB/seq (取决于 TP)，相比 GA 的数百 MB (16K 时) 几乎可忽略。
这意味着 **长序列场景下，GA 层的 KV cache 是唯一瓶颈**。

---

## 注意事项

- 以上计算未考虑 paged KV cache 的页级碎片 (~10-15% overhead)
- 未计算 activation memory (prefill 大 batch 时可能显著)
- MoE all-to-all 通信 buffer 额外占用 ~100-500 MB
- 实际可用空间可能比计算值低 5-10%
