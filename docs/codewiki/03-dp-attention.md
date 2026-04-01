# DP Attention 适配分析

## 什么是 DP Attention

DP (Data Parallel) Attention 将模型拆分为两个并行维度:
- **Attention 部分**: 用 DP 数据并行 + 低 TP 张量并行
- **MoE 部分**: 用 EP 专家并行 (全设备参与)

```
                    DP Group 0          DP Group 1         ...    DP Group 7
Attention:        [dev0, dev1]        [dev2, dev3]               [dev14, dev15]
                   TP=2 内部           TP=2 内部                  TP=2 内部
                   BS/8 独立           BS/8 独立                  BS/8 独立
                      ↕                    ↕                         ↕
MoE:            ←————————————— EP=16, 全 16 设备 all-to-all ——————————————→
```

核心优势: **KV Cache 不需要跨 DP group 同步**，每个 DP group 独立存储自己的 KV cache。

## 为什么 MiMo V2 Flash 特别需要 DP Attention

### 1. KV Head 数极少

MiMo V2 Flash 的 GQA 配置非常激进:
- GA: 仅 4 KV heads (ratio 64:4 = 16:1)
- SWA: 仅 8 KV heads (ratio 64:8 = 8:1)

当 TP > 4 (GA) 或 TP > 8 (SWA) 时，必须做 head replication。TP=16 下浪费 4-8x。

### 2. MoE 需要全设备 EP

256 experts 需要 EP 分布。EP=16 时每设备 16 experts，EP=32 每设备 8 experts。
MoE 的 all-to-all 通信跨全部设备，与 attention 的 TP 通信解耦。

### 3. SWA Window 极小

128-token window 意味着 SWA KV cache 是固定的小常数。只有 GA 层 (9/48) 的 KV cache 随序列长度增长。这使得 DP attention 的 KV cache 节省更加突出。

## 配置方案对比

### 推荐: 16卡 DP=8, TP=2

| 维度 | 详情 |
|------|------|
| DP groups | 8 组, 每组 2 设备 |
| TP | 2 (组内) |
| EP | 16 (全设备) |
| GA KV heads/device | 4/2 = 2 ✓ (满足 uint32) |
| SWA KV heads/device | 8/2 = 4 ✓ |
| Head replication | **无** |
| Attention AllReduce | 组内 2 设备间 |
| MoE All-to-All | 全 16 设备 |

**关键收益:**
- KV cache per device 降至理想值 (无任何 padding/replication)
- 每 device 只需存 BS/8 个序列的 KV cache
- Max BS 提升 **4.5x** (4K input) / **4.8x** (16K input)

### 备选: 16卡 DP=4, TP=4

| 维度 | 详情 |
|------|------|
| DP groups | 4 组, 每组 4 设备 |
| GA KV heads/device | 4/4 = 1 (需 pad 到 2 或 fix uint32) |
| SWA KV heads/device | 8/4 = 2 ✓ |

- 优点: Attention AllReduce 通信量相对小 (TP=4 分得更细)
- 缺点: GA 仍需 head padding (除非 fix uint32)
- 如果 fix uint32: Max BS 提升 **6.8x** (最优 16 卡方案)

### 32卡扩展: DP=16, TP=2

- MoE 权重减半 (EP=32, 每设备 8 experts)
- 可用 KV 空间从 5.6 GB 增至 15.0 GB
- Max BS 达 4,160 (4K) / 1,216 (16K)

## 实现路线

### Phase 1: 通信拓扑修改

```
1. Attention TP group: 将设备按 DP group 分组
   - Group 0: [dev0, dev1], Group 1: [dev2, dev3], ...
   - 组内做 AllReduce (for Q·K attention + O projection)

2. MoE EP group: 保持全设备 All-to-All
   - 所有 16 设备参与 expert dispatch/combine

3. KV Cache: 每 device 独立管理自己 DP group 的 KV
   - 不需要跨 group 同步
   - Scheduler 按 DP group 分配 batch
```

### Phase 2: Scheduler 适配

```
1. Batch 分割:
   - 总 batch 按 DP 数均分
   - 每个 DP group 独立调度 prefill/decode

2. 负载均衡:
   - 各 DP group 可能有不同的 seq 长度分布
   - 需要 cross-group 负载均衡策略
   - 或者用 global scheduler + local dispatch

3. 连续 batching:
   - 每个 DP group 独立做连续 batching
   - 新请求 round-robin 或最轻负载分配到 DP group
```

### Phase 3: Prefill-Decode 解耦 (可选)

```
- 某些 DP group 专做 prefill (需要更多 activation memory)
- 其余 DP group 做 decode (需要更多 KV cache)
- 根据请求特征动态调整
```

## 通信开销分析

### TP=16 (当前)
- Attention AllReduce: 16 设备, 数据量大
- MoE All-to-All: 16 设备
- Total: 两个跨 16 设备的集合通信

### DP=8, TP=2
- Attention AllReduce: 2 设备 (组内), 非常快
- MoE All-to-All: 16 设备 (不变)
- Total: MoE 通信不变, attention 通信大幅降低
- 额外: batch embedding/output 需要 scatter/gather (小量)

### 通信量对比

| 操作 | TP=16 | DP=8, TP=2 | 变化 |
|------|-------|-----------|------|
| Attention QKV | AllReduce over 16 | AllReduce over 2 | **8x 降低** |
| MoE dispatch | All2All over 16 | All2All over 16 | 不变 |
| MoE combine | All2All over 16 | All2All over 16 | 不变 |
| Input scatter | N/A | Scatter to 8 groups | 新增 (小量) |
| Output gather | N/A | Gather from 8 groups | 新增 (小量) |

## 风险与注意事项

1. **MoE All-to-All 路由变化**: DP attention 后, 每个 DP group 处理的 token 子集不同, all-to-all 的 token 分布模式会变。需要验证 expert 负载均衡不受影响。

2. **Prefill 大 batch activation**: DP=8 时每 device 处理 BS/8 的 prefill, activation memory 需要按新 BS/device 重新评估。

3. **Pipeline 一致性**: 确保 GA 和 SWA 层的 DP 分割一致，不需要中间做数据重分配。

4. **Embedding 层处理**: vocab embedding 和 LM head 在 TP=2 下较大 (每 device 625 MB)。可考虑保持这两层 TP=16 或使用 sequence parallel。

5. **调试复杂度**: 多维并行 (DP + TP + EP) 增加调试难度。建议先在小规模验证正确性。
