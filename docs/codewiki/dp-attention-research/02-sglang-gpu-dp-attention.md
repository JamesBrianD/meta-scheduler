# SGLang GPU DP Attention 实现分析

> 来源: sgl-project/sglang GitHub 仓库代码分析

## 核心概念

DP Attention 将 TP group 内的设备分为多个 DP 子组:
- **Attention 阶段**: 每个 DP 子组独立处理不同的请求子集, 有独立 KV cache
- **MoE/MLP 阶段**: 所有 DP 子组通过 all_gather 合并, 在全局 tensor 上运行

## 并行层级

```
Global TP group (tp_size GPUs)
  └── DP groups (dp_size groups, each with attn_tp_size = tp_size / dp_size / attn_cp_size)
       └── ATTN_CP groups (context parallelism, optional)
            └── ATTN_TP groups (innermost, attention all-reduce)

For MoE:
  └── MOE_DP groups
       └── EP groups (expert parallelism)
            └── MOE_TP groups
```

约束: `dp_size <= tp_size`, `tp_size % dp_size == 0`

## 关键文件

| 文件 | 角色 |
|---|---|
| `layers/dp_attention.py` | DP gather/scatter 原语, buffer 管理, padding 模式 |
| `managers/data_parallel_controller.py` | 请求分发, DP rank 负载均衡 |
| `managers/scheduler_dp_attn_mixin.py` | `prepare_mlp_sync_batch()` 跨 DP rank 同步 |
| `layers/communicator.py` | `LayerCommunicator`: MoE 前 dp_gather, MoE 后 dp_scatter |
| `managers/prefill_delayer.py` | 延迟 prefill 减少 DP 不平衡 |

## 数据流 (每层 Transformer)

```
1. ATTENTION (per DP rank, 独立):
   - 每个 DP rank 只处理自己的 LOCAL tokens
   - 使用 attn_tp_group 做 attention all-reduce

2. dp_gather (TRANSITION):
   - hidden_states 从所有 DP ranks GATHER 到全局 buffer
   - 两种策略 (DpPaddingMode):
     a. MAX_LEN: pad 到 max, 用 all_gather_into_tensor
     b. SUM_LEN: pad 到 sum, 用 all_reduce (适合不均匀分布)
   - Gather 后所有 rank 看到所有 tokens

3. MoE/MLP (global):
   - 在 FULL gathered tensor 上运行
   - MoE all-to-all 跨全部 tp_group

4. dp_scatter (TRANSITION):
   - Global MoE output SCATTER 回各 DP rank
   - 每个 rank 提取自己的 slice
```

## DP Scheduler 架构

**不是** 每个 DP rank 一个 scheduler。而是:
- `DataParallelController` 是**单个控制器进程** (node 0)
- `launch_dp_attention_schedulers()` 启动所有 TP rank 在**同一进程组**
- 控制器通过 ZMQ sockets 分发请求到各 DP rank

### 负载均衡

四种策略:
| 方法 | 描述 |
|---|---|
| `ROUND_ROBIN` | 轮询 (默认) |
| `TOTAL_REQUESTS` | 最少请求数 |
| `TOTAL_TOKENS` | 最少 token 数 (DP attention 最优) |
| `FOLLOW_BOOTSTRAP_ROOM` | PD 分离模式 |

## MLPSyncBatch (DP 同步)

Forward 前各 DP rank 必须同步:
- `global_num_tokens` (各 rank token 数)
- `is_extend_in_batch` (是否有 prefill)
- `can_cuda_graph` (所有 rank 必须一致)

通过 `all_gather_into_tensor` 跨全 TP group 完成。
空闲 rank 创建 "idle batch" 参与 MoE 同步。

## Prefill Delayer

解决 DP 不平衡: 延迟 prefill 直到所有 DP rank 都有可 prefill 的请求 (或超过 max_delay=30 passes)。

## MTP/Speculative Decode 兼容性

| 模式 | 兼容 DP Attention? |
|------|-------------------|
| MTP (NextN) | 是 (post v0.4.8, draft 用 `draft_tp_context`) |
| EAGLE/EAGLE3 | 是 (draft 用 `draft_tp_context(attn_tp_group)`) |
| Standalone spec decode | 否 |
| NGRAM spec decode | 否 |

`disable_dp_size()` context manager 临时设 `_ATTN_DP_SIZE = 1` 用于 draft execution。

## 配置

```bash
# 典型启动命令
python -m sglang.launch_server \
  --model-path deepseek-ai/DeepSeek-V3 \
  --tp 8 --dp 8 --enable-dp-attention \
  --load-balance-method total_tokens
```
