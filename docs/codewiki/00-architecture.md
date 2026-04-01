# MiMo V2 Flash 架构速查

> 基于 [config.json](https://huggingface.co/XiaomiMiMo/MiMo-V2-Flash/blob/main/config.json) 提取

## 基本参数

| 参数 | 值 | 备注 |
|------|-----|------|
| 总参数量 | ~309B | MoE 架构 |
| 激活参数量 | ~15B | top-8 of 256 experts |
| hidden_size | 4096 | |
| num_hidden_layers | 48 | 9 GA + 39 SWA |
| vocab_size | 152576 | |
| max_position_embeddings | 262144 | 256K context |
| torch_dtype | bfloat16 | |

## Attention 架构 (Hybrid Attention)

| 参数 | Global Attention (GA) | Sliding Window (SWA) |
|------|----------------------|---------------------|
| 层数 | 9 | 39 |
| num_attention_heads (Q) | 64 | 64 |
| num_key_value_heads | 4 | 8 |
| head_dim (K) | 192 | 192 |
| v_head_dim (V) | 128 | 128 |
| rope_theta | 5,000,000 | 10,000 |
| sliding_window | N/A (全局) | 128 tokens |
| attention_chunk_size | N/A | 128 |
| attention_sink_bias | false | true |

### Hybrid Layer Pattern

```
Layer:   0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20 21 22 23
Type:    GA SW SW SW SW GA SW SW SW SW SW GA SW SW SW SW SW GA SW SW SW SW SW GA

Layer:   24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47
Type:    SW SW SW SW SW GA SW SW SW SW SW GA SW SW SW SW SW GA SW SW SW SW SW GA
```

规律: Layer 0 独立为 GA，之后每 6 层一个 GA (位于 5, 11, 17, 23, 29, 35, 41, 47)

### 关键设计特点

1. **非对称 head_dim**: K/Q 用 192 dim，V 用 128 dim。注意 O_proj 的输入维度是 `num_heads × v_head_dim = 64 × 128 = 8192`，而非 `num_heads × head_dim`
2. **部分 RoPE**: `partial_rotary_factor = 0.334`，仅前 64 维 (192 × 0.334 ≈ 64) 应用旋转位置编码
3. **极小滑动窗口**: SWA window = 128 tokens，远小于常见的 4096/8192
4. **Value 缩放**: `attention_value_scale = 0.707 (≈1/√2)`

## MoE 架构

| 参数 | 值 | 备注 |
|------|-----|------|
| n_routed_experts | 256 | |
| num_experts_per_tok | 8 | top-8 routing |
| moe_intermediate_size | 2048 | 每个 expert 的 FFN 中间维度 |
| n_shared_experts | null | 无共享 expert |
| scoring_func | sigmoid | 非 softmax |
| norm_topk_prob | true | top-k 后归一化 |
| topk_method | noaux_tc | Token-Choice, 无辅助损失 |
| n_group | 1 | 无 expert 分组 |
| topk_group | 1 | |

### MoE Layer 分布

```
moe_layer_freq: [0, 1, 1, ..., 1]  (48 elements)
```

- Layer 0: Dense FFN (intermediate_size = 16384)
- Layer 1-47: MoE (47 个 MoE 层)

### 单 Expert 权重量

```
gate_proj: 4096 × 2048 = 8,388,608 params
up_proj:   4096 × 2048 = 8,388,608 params
down_proj: 2048 × 4096 = 8,388,608 params
Total:     25,165,824 params ≈ 25.2M params/expert
```

256 experts × 25.2M = 6,451M ≈ 6.45B params/MoE layer
47 MoE layers × 6.45B = 303B params (MoE 部分)

## FP8 量化配置 (已在权重中)

| 参数 | 值 |
|------|-----|
| quant_method | fp8 |
| fmt | e4m3 |
| activation_scheme | dynamic |
| weight_block_size | [128, 128] |
| ignored_layers | 所有 49 个 o_proj (48 transformer + 1 decoder) |

## 权重内存估算

### 每层参数量

| 组件 | GA 层 | SWA 层 |
|------|-------|--------|
| Q_proj (4096→12288) | 50.3M | 50.3M |
| K_proj | 3.1M (4096×768) | 6.3M (4096×1536) |
| V_proj | 2.1M (4096×512) | 4.2M (4096×1024) |
| O_proj (8192→4096) | 33.6M | 33.6M |
| **Attention 合计** | **89.1M** | **94.4M** |
| MoE (256 experts) | 6,451M | 6,451M |
| Router | 1.0M | 1.0M |

### 全模型参数量

| 组件 | 参数量 |
|------|--------|
| 9 GA attention | 802M |
| 39 SWA attention | 3,682M |
| 47 MoE layers | 303,197M |
| Dense FFN (Layer 0) | 201M |
| Embeddings | 625M |
| LM Head | 625M |
| **Total** | **~309B** |
