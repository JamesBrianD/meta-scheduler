# SGLang JAX 当前状态分析

> 来源: /Users/ramezes/job/sgl-project/sgl-jax 代码分析

## 代码库位置

`/Users/ramezes/job/sgl-project/sgl-jax`, latest commit: `f288b9d2 fix head dim packing`

## DP Attention 就绪度评估

| 组件 | 当前状态 | DP Attention 差距 |
|------|---------|-----------------|
| **Mesh** | 2D `(data, tensor)`, data 永远为 1 | 需要设 data > 1 |
| **Attention** | TP-only shard_map, batch 全量复制 | 需要 DP attention path |
| **KV Cache** | 单池, 仅 TP head 分片 | 需要 per-DP-rank 分区 |
| **Scheduler** | 单进程, dp_size>1 是 `pass` | 需要 DP-aware 调度 |
| **MoE** | FusedEPMoE 已用 `("data","tensor")` | **最接近就绪** |
| **Engine** | dp_size>1 路径为空 stub | 需要实现 |

## 1. Mesh (mesh_utils.py)

```python
default_mesh_axes = ["data", "tensor"]
# 创建时: ici_parallelism=[-1, tp_size] → data 永远为 1
```

支持多 slice (`num_slices > 1`) 通过 `create_hybrid_device_mesh`。

## 2. Attention (flashattention_backend.py)

使用 `shard_map`, Q/K/V 仅按 `"tensor"` 轴分片:
```python
# Fused KV path:
Q/K/V: P(None, "tensor")     # heads across tensor
KV cache: P(None, None, "tensor", None)
metadata: P()                 # fully replicated
```

无 DP awareness。`RadixAttention` 是薄包装。

## 3. MoE (moe.py / fused_moe.py)

**EPMoE (GMM)**: 创建独立 `moe_mesh` = `(ep_size, tp_size)`, axes `("expert", "tensor")`
- 权重: `P("expert", "tensor", None)` / `P("expert", None, "tensor")`

**FusedEPMoE (Pallas)**: 权重用 `P(("data", "tensor"), None, None)` — 专家跨全 mesh 分片
- Kernel 内部计算 `dp_rank` 和 `tp_rank`
- **已经具备 data 轴感知**, 是最接近 DP attention 就绪的组件

## 4. KV Cache (memory_pool.py)

| 实现 | 分片 | 说明 |
|------|------|------|
| `MHATokenToKVPool` | `P(None, "tensor", None)` | Fused K/V 交错 |
| `SplitMHATokenToKVPool` | `P(None, "tensor", None)` | K/V 分离, 不同 head_dim |
| `MLATokenToKVPool` | `P(None, None, None)` | MLA 压缩表示, 无分片 |
| `SWAKVPool` | 包装两个子池 | Hybrid SWA + Full attention |

`ReqToTokenPool` 是 host-side numpy, 无设备分片。

## 5. Scheduler (scheduler.py)

单进程设计。dp_size > 1 的路径:
```python
if server_args.dp_size == 1:
    # ... normal single-scheduler
else:
    pass  # literally empty
```

`dp_size` 参数在 ServerArgs 中定义 (line 92) 但未使用。

## 6. MTP 实现 (mimo_mtp.py)

已实现 MiMo MTP:
- `MiMoMTPLayer`: embed_tokens + layernorms + input_proj(2H→H) + Qwen2DecoderLayer
- 用作 EAGLE-style speculative decode 的 draft model
- EAGLE worker 存在于 `speculative/eagle_worker.py`

## 7. Multi-Modal 支持

活跃开发中:
- Qwen2.5-VL (Vision), Qwen3-Omni-MoE (Vision+Audio), MiMo-Audio
- 有独立的 multi-stage pipeline scheduler
- `scheduler.py line 174`: multimodal 时禁用 overlap

## 8. Multi-Host TPU

- `jax.distributed.initialize()` 用于 nnodes > 1
- `create_hybrid_device_mesh` 支持多 slice
- 多节点时禁用 overlap schedule (stability)
- 已知问题: radix cache hit n-1 tokens 时多节点挂起

## 关键文件路径

| 文件 | 内容 |
|---|---|
| `srt/utils/mesh_utils.py` | Mesh 创建 |
| `srt/layers/attention/flashattention_backend.py` | Attention shard_map |
| `srt/layers/radix_attention.py` | Attention 封装 |
| `srt/layers/moe.py` | GMM EPMoE |
| `srt/layers/fused_moe.py` | Pallas FusedEPMoE |
| `srt/mem_cache/memory_pool.py` | KV cache 池 |
| `srt/managers/scheduler.py` | 调度器 |
| `srt/managers/engine.py` | Engine (dp stub) |
| `srt/models/mimo_mtp.py` | MiMo MTP |
| `srt/speculative/eagle_worker.py` | EAGLE worker |
