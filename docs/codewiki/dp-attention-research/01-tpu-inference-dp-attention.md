# tpu-inference DP Attention 实现分析

> 来源: primatrix/wiki `gap-dp-attention.md` + `tpu-inference-q2.md`

## 5D Mesh 设计

```python
MESH_AXIS_NAMES = ("data", "attn_dp", "attn_dp_expert", "expert", "model")
```

### 分片轴语义

| 轴名 | 组合轴 | 用途 |
|---|---|---|
| `ATTN_DATA` | `('data', 'attn_dp', 'attn_dp_expert')` | Attention Batch/Seq 分片 |
| `ATTN_HEAD` | `('model', 'expert')` | KV Head 分片 |
| `MLP_DATA` | `'data'` | MLP/MoE Batch 分片 |
| `MLP_TENSOR` | `('attn_dp', 'attn_dp_expert', 'model', 'expert')` | MLP 权重分片 |
| `EXPERT` | `('attn_dp', 'attn_dp_expert', 'expert', 'model')` | 专家权重分片 |

**核心思想**: Attention 和 MLP 阶段使用不同的分片策略:
- **Attention**: Batch 跨所有 DP 轴分片, 每设备独立 KV cache
- **MLP/MoE**: Batch 仅按 data 分片, 权重跨所有剩余轴 (完整模型并行)

### DP Degree 自动计算

```python
# sharding.py lines 163-209
num_kv_heads_per_device = max(1, (num_kv_heads * 2) / packing)

if tensor_parallelism > num_kv_heads_per_device:
    attn_dp = tensor_parallelism // num_kv_heads_per_device
    tensor_parallelism //= attn_dp
    attn_dp_expert = expert_parallelism
    expert_parallelism = 1
```

### DP Scheduler (多进程)

```
DPScheduler
  ├── Worker 0 (独立进程, Pipe 通信)
  │     └── Scheduler + KV Cache (blocks // dp_size)
  ├── Worker 1 (独立进程)
  └── Worker N (独立进程)
```

负载均衡策略:
1. **Prefix Cache 亲和性**: 探测所有 rank 的 prefix cache, 分配到缓存最多的 rank
2. **最少负载回退**: 无 cache 命中时分配到总 token 数最少的 rank
3. **Sticky 分配**: 一旦分配不迁移

通信: `multiprocessing.Pipe` (避免 GIL) + `cloudpickle`

### Runner 端 DP 输入准备

```python
# tpu_runner.py: _prepare_dp_input_metadata()
# 1. 按 rank 分组请求
# 2. Per-rank padding 到相同大小
# 3. Block table 重排：每个 rank 占据连续段
# 4. 所有输入标记 PartitionSpec(ATTN_DATA) 分片
```

### KV Cache 适配

- 页维度跨 ATTN_DATA 分片
- KV heads 跨 ATTN_HEAD 分片
- 连续块分配器: best-fit 搜索优化 dynamic_update_slice

### 关键文件

| 文件 | 内容 |
|---|---|
| `layers/common/sharding.py` | 5D Mesh, 分片轴, DP degree 计算 |
| `core/sched/dp_scheduler.py` | 多进程 DP 调度器 |
| `runner/tpu_runner.py:324-394` | Mesh 构建 |
| `runner/tpu_runner.py:1139-1203` | DP 输入准备 |
