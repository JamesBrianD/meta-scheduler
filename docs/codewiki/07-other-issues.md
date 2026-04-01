# 其他已知问题与潜在问题

## 已知问题 (开发分支侵入性修改)

### 1. Allocator 缺失回滚 (allocator.py)

**问题**: `alloc_extend` / `alloc_decode` 中, 如果 SWA 分配失败, 已完成的 full (GA) 分配不会被释放。

**影响**:
- 内存泄漏: GA 的 KV cache 分配了但对应的 SWA 未分配, 序列无法正常推理
- 反复触发后, 可用 KV cache 空间逐渐减少
- 极端情况: OOM 或死锁

**修复建议**:
```python
# 伪代码
ga_pages = alloc_ga(...)
try:
    swa_pages = alloc_swa(...)
except AllocationError:
    free_ga(ga_pages)  # 回滚 GA 分配
    raise
```

### 2. 多 Node Scheduler 禁用 overlap

**问题**: 多节点部署时, scheduler 禁用了 prefill/decode overlap。

**影响**:
- 多节点吞吐量下降: prefill 和 decode 不能并行, GPU/TPU 利用率降低
- 单节点不受影响

**原因推测**: 跨节点的 all-to-all 通信可能与 overlap 逻辑冲突

### 3. Schedule Batch Decode Fast-path

**问题**: `schedule_batch.py` 中添加了 decode 的 fast-path 逻辑。

**风险**: 需要验证 fast-path 在各种 edge case 下的正确性:
- 混合 prefill + decode batch
- 序列被 preempt 后恢复
- KV cache eviction 后重新加载

### 4. MoE 权重布局翻转

已在前面 [05-moe-optimization.md](05-moe-optimization.md) 分析。需要 benchmark 验证翻转后的性能。

---

## 潜在问题 (从架构分析发现)

### 5. 非对称 head_dim 引起的 Kernel 低效

**现象**: K 的 head_dim=192, V 的 v_head_dim=128, 两者不同。

**潜在问题**:
- 某些 attention kernel 实现假设 `head_dim == v_head_dim`, 可能有隐式 padding 或错误
- QKV 的 concat/split 操作可能因非对称 dim 效率低下
- O_proj 的输入是 `num_heads × v_head_dim = 64 × 128 = 8192`, 而非 `num_heads × head_dim = 12288`

**验证**: 检查 attention kernel 是否对 K dim ≠ V dim 做了正确处理, 有无不必要的 padding

### 6. Partial RoPE 的计算浪费

**现象**: `partial_rotary_factor = 0.334`, 仅 64/192 维度应用 RoPE。

**潜在问题**:
- 如果 RoPE kernel 对全 192 维计算后再 mask 掉 128 维 → 67% 计算浪费
- 正确实现应只对前 64 维做 sin/cos 计算

**验证**: 检查 RoPE 实现是否真的只计算 64 维

### 7. attention_value_scale 的精度影响

**现象**: `attention_value_scale = 0.707 ≈ 1/√2`, 应用于 value。

**潜在问题**:
- 这个缩放因子可能在 FP8 计算中引入额外精度损失
- 需要确保在正确的位置 (attention output 乘 value 后) 应用
- 如果放错位置 (比如 softmax 前), 会改变注意力分布

### 8. SWA Attention Sink Bias

**现象**: `add_swa_attention_sink_bias = true` (SWA), `add_full_attention_sink_bias = false` (GA)

**问题**: Attention sink 是给序列开头 token 添加额外 bias, 防止注意力分数衰减。

**潜在问题**:
- SWA window=128 极小, sink token 可能已经滑出 window → sink bias 如何处理?
- 需要验证: 当 sink token 在 window 外时, bias 是否正确忽略
- 如果始终保留 sink token 在 KV cache 中 (即使超出 window), 那 SWA 的 KV cache 不完全是固定的 128

### 9. Sigmoid Router + No Aux Loss 的负载均衡

**现象**: `scoring_func = sigmoid`, `topk_method = noaux_tc`, `n_group = 1`

**潜在问题**:
- Sigmoid (非 softmax) 意味着 expert scores 不互斥, 多个 expert 可以有高分
- 无辅助损失 (noaux) 意味着没有显式的负载均衡训练信号
- 在推理时, 如果某些 expert 系统性地比其他 expert 热门, 会导致严重的 load imbalance
- `n_group = 1` 意味着没有 expert 分组来限制 all-to-all 范围

**影响**: MoE 计算中, 最慢的 expert 决定整层时间。负载不均衡直接降低 MXU 利用率。

**验证**: 收集实际推理时的 expert 负载分布, 计算 max/mean ratio

### 10. Layer 0 Dense FFN 的瓶颈

**现象**: Layer 0 是唯一的 dense FFN 层, `intermediate_size = 16384`

**计算量**:
```
Layer 0 FFN per token:
  gate_up: 4096 × 32768 × 2 FLOPs = 268M FLOPs
  down:    16384 × 4096 × 2 FLOPs = 134M FLOPs
  Total:   402M FLOPs

MoE layer per token (8 active experts):
  8 × (4096×4096×2 + 2048×4096×2) = 8 × 50.3M = 402M FLOPs
```

Layer 0 的计算量与 MoE 层相当! 但:
- Dense FFN 没有 all-to-all 通信
- Dense FFN 的权重在 TP 下分割良好
- 但 Layer 0 是序列化瓶颈 (所有 tokens 都经过)

### 11. Embedding 层的 TP/DP 处理

**现象**: `vocab_size = 152576`, Embedding 权重 = 152576 × 4096 × 2B = 1.19 GB

**潜在问题 (DP Attention 下)**:
- TP=2 时, Embedding 分割为 2 份 → 每份 595 MB
- 但 DP=8 时, 需要每个 DP group 都有完整 embedding (或做 all-gather)
- LM Head 同样大, 且不在 FP8 量化范围内 (需要 bf16 做 softmax)

**选项**:
- Embedding/LM Head 保持 TP=16 (只分割不复制) → 需要跨 DP group 通信
- 每个 DP group 复制 → 额外 ~1.2 GB/device
- Sequence Parallel → 分割序列维度而非 vocab 维度

### 12. KV Cache Page Size 选择

**潜在问题**: Paged KV cache 的 page_size 影响:
- **太小**: page table 开销大, 频繁 page lookup
- **太大**: 内存碎片严重, 浪费空间
- **MiMo 特殊考虑**: SWA window=128, 如果 page_size 不能整除 128, 会浪费 SWA KV cache

**建议**: page_size 应该是 128 的因子 (1, 2, 4, 8, 16, 32, 64, 128)

### 13. 双 RoPE Theta 的 Cache 问题

**现象**: GA 用 `rope_theta=5,000,000`, SWA 用 `swa_rope_theta=10,000`

**潜在问题**:
- RoPE 的 frequency table 需要按 theta 预计算
- 如果代码只预计算一份, 另一种 attention 会用错频率
- 需要两套 cos/sin cache, 分别用于 GA 和 SWA 层

---

## 问题优先级总结

| # | 问题 | 严重度 | 已确认? | 优化关联 |
|---|------|--------|---------|---------|
| 1 | Allocator 回滚缺失 | 高 | 是 | 稳定性 |
| 5 | 非对称 head_dim kernel | 中 | 待验证 | Attention 性能 |
| 6 | Partial RoPE 浪费 | 中 | 待验证 | Prefill 性能 |
| 8 | SWA sink bias + sliding | 中 | 待验证 | 正确性 |
| 9 | MoE 负载均衡 | 高 | 待测量 | MoE 性能 |
| 10 | Layer 0 dense 瓶颈 | 低 | 架构决定 | 了解即可 |
| 11 | Embedding DP 处理 | 中 | 待设计 | DP Attention |
| 12 | Page size vs SWA window | 低 | 待验证 | KV cache |
| 13 | 双 RoPE theta cache | 低 | 待验证 | 正确性 |
