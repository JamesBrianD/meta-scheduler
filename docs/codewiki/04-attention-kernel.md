# Attention Kernel 优化路线

## 当前状态: Ragged Paged Attention (RPA)

当前使用 SGLang 的 `ragged_paged_attention` kernel:
- 支持 paged KV cache
- 支持 ragged batch (不同序列不同长度)
- 在 Pallas 上实现

### 已知性能问题

1. **Dim padding overhead**: head_dim=192 pad 到 256, 占 prefill ~7%
2. **KV cache reshape**: 每次 forward 后做 256→192 dim reshape (Bug)
3. **Head replication**: TP=16 下 GA/SWA 的 KV heads padding
4. **非对称 head dim**: K dim=192, V dim=128, kernel 可能未充分利用

## 优化路线图

### Level 0: 修复 Padding Bug (当前可做)

```
Before:
  load weights → compute QKV (192 dim) → pad K to 256 → flash attention
  → unpad K to 192 → replace KV buffer → next forward repeat pad/unpad

After:
  load weights (pad K proj to 256) → compute QKV (K=256, V=128) → flash attention
  → KV cache stays 256 dim → no runtime pad/unpad
```

预期收益:
- Prefill: ~7-11% 提升 (消除 padding 操作)
- Decode: ~1.5x 提升 (消除 KV cache reshape)
- 实现难度: 低 (修改 weight loading + 移除 runtime padding)

### Level 1: Split KV RPA

将 KV cache 按 head 维度 split 到多个 worker:

```
当前 (单个 kernel 处理所有 KV heads):
  attention(Q, K_cache[all_heads], V_cache[all_heads])

Split KV (每个 worker 处理部分 heads):
  partial_0 = attention(Q, K_cache[heads_0:2], V_cache[heads_0:2])
  partial_1 = attention(Q, K_cache[heads_2:4], V_cache[heads_2:4])
  output = reduce(partial_0, partial_1)
```

适用场景: TP=2 下 GA 有 2 heads/device, SWA 有 4 heads/device
- SWA 的 4 heads 可以 split 为 2+2, 提高并行度

预期收益:
- 更好的 MXU 利用率 (更小的 tile 更适合硬件)
- Decode 延迟降低 (并行处理不同 head groups)

### Level 2: Fused KV RPA

将 Split KV 的 scatter/compute/gather 融合到单个 kernel:

```
当前:
  load K_pages → split → compute attention tiles → reduce → store

Fused:
  fused_paged_attention(Q, K_cache, V_cache, page_table)
  // 内部自动处理 page 遍历 + head split + reduction
```

预期收益:
- 减少 kernel launch overhead
- 减少中间结果的 HBM 读写
- 更好的计算/访存重叠

## Prefill Kernel 优化

### 当前瓶颈

Prefill 阶段的特点:
- 大量 tokens 并行处理 (batch × seq_len)
- Compute-bound (矩阵乘法为主)
- 需要 causal mask

### 优化方向

1. **Chunked prefill**: 将长序列拆分为 chunk, 逐 chunk 计算并更新 KV cache
   - MiMo 的 SWA window=128 天然适合 chunk_size=128
   - GA 层需要 cross-chunk attention (用 ring attention 或 sequential update)

2. **Flash Attention 2/3 适配**:
   - 当前 Pallas kernel 可能未实现最优的 tiling strategy
   - 需要 benchmark 理想状态下的 Pallas flash attention 性能上限
   - 对比 XLA 生成代码 vs 手写 Pallas kernel

3. **SWA 专用 kernel**:
   - SWA window=128 极小, 可以用更激进的 tiling
   - 不需要 causal mask 的全量计算, 只需要 128-token 窗口
   - 可能直接用 VMEM 存下整个 window 的 KV

## Decode Kernel 优化

### 当前瓶颈

Decode 阶段特点:
- 每次只处理 1 个新 token (per sequence)
- Memory-bound (KV cache 读取为主)
- 需要读取所有历史 KV cache (GA) 或最近 128 tokens (SWA)

### 优化方向

1. **Paged attention 优化**:
   - 减少 page table lookup overhead
   - 连续 pages 的 prefetch
   - Page 大小优化 (当前 page_size 待确认)

2. **GQA 优化**:
   - MiMo 的 GQA ratio 很高 (16:1 for GA, 8:1 for SWA)
   - 可以 broadcast KV 而非 repeat, 减少内存访问
   - 利用 TPU 的 vector unit 做高效 broadcast

3. **Multi-query batch decode**:
   - 多个 decode 请求共享同一份 KV cache 操作
   - 在 DP attention 下更有效 (每 DP group 独立 batch decode)

## Benchmark 计划

### Baseline 建立

```
1. 单层 attention kernel profiling:
   - GA layer: Q[bs, 64, 192] × K_cache[seq, 4, 192] → time
   - SWA layer: Q[bs, 64, 192] × K_cache[128, 8, 192] → time

2. 对比配置:
   - seq_len: 128, 1K, 4K, 16K, 64K
   - batch_size: 1, 8, 32, 128
   - 分别测 prefill 和 decode

3. 理论上限计算:
   - Compute: FLOPs / peak_tflops
   - Memory: bytes_accessed / peak_bandwidth
   - Roofline: min(compute_time, memory_time)

4. Gap 分析:
   - actual_time / theoretical_min → 效率百分比
   - 识别是 compute-bound 还是 memory-bound
```

### MiMo 特有的 Benchmark 要点

1. **非对称 head_dim 影响**: 测试 K=192, V=128 vs K=V=128 vs K=V=192 的性能差异
2. **partial RoPE 开销**: 仅 64/192 维做 RoPE, 测试 full vs partial RoPE 性能
3. **attention_value_scale**: 1/√2 缩放的影响
4. **SWA sink bias**: `add_swa_attention_sink_bias=true` 的开销
5. **极小 window (128)**: SWA decode 是否可以完全 on-chip

## 优先级

| 优化 | 优先级 | 难度 | 预期收益 |
|------|--------|------|---------|
| Fix dim padding | P0 | 低 | Prefill +11%, Decode +50% |
| Baseline benchmark | P0 | 中 | 建立性能参考线 |
| Split KV RPA | P1 | 中 | Decode 延迟降低 20-30% |
| SWA 专用 kernel | P1 | 中 | SWA 层 2x+ |
| Fused KV RPA | P2 | 高 | Decode 进一步 10-20% |
| Flash Attention 3 | P2 | 高 | Prefill 理论上限 |
