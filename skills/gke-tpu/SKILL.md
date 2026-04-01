---
name: gke-tpu
description: Manage GKE-based TPU workloads — provision clusters via xpk, sync code, run multi-process benchmarks, profile Pallas kernels with xprof LLO, and teardown. Use when the user wants to create/manage/run/profile TPU workloads on GKE. Reads config from .claude/gke.toml.
argument-hint: "<command> [args...]"
---

# GKE TPU Skill

Manage GKE-based TPU workloads via `xpk`. Config-driven via `.claude/gke.toml`.

## Commands

| Command | Description | Reference |
|---|---|---|
| `create` | Provision cluster and/or workload | [references/create.md](references/create.md) |
| `sync` | Sync code + install deps to all containers | [references/sync.md](references/sync.md) |
| `run` | Execute script on multi-process TPU | [references/run.md](references/run.md) |
| `profile` | Run with xprof LLO profiling | [references/profile.md](references/profile.md) |
| `teardown` | Delete workload or cluster | [references/teardown.md](references/teardown.md) |
| `status` | Check pod/workload status | [references/teardown.md](references/teardown.md) |

**Read the relevant reference file for the user's command before executing.**

## Configuration

Read `.claude/gke.toml` at the start of every command. Never hardcode project/cluster/zone.

```toml
[gke]
project = "poc-tpu-partner"
cluster = "tpuv6e-256-node"
zone = "us-east5"

[tpu]
type = "v6e-256"
num_slices = 1
spot = true

[workload]
name = "my-workload"
docker_image = "us-docker.pkg.dev/cloud-tpu-images/jax-ai-image/tpu:jax0.8.1-rev1"

[repo]
git_url = "https://github.com/sgl-project/sglang-jax.git"
remote_path = "/tmp/sglang-jax"
python_subdir = "python"
install_cmd = "pip install --no-deps -e ."

[repo.deps]
packages = ["pyzmq", "fastapi", "..."]

[profile]
gcs_bucket = "gs://bucket/profile_tmp"
```

## Critical Rules

1. **Multi-container pods**: TPU pods have multiple containers with independent filesystems. All setup/execution on ALL containers.
2. **Simultaneous launch**: `jax.distributed.initialize()` must run in all containers at the same time.
3. **Same code path**: ALL processes must execute the SAME jitted computations. Never have workers just `sleep()`.
4. **Docker image must match JAX version** in pyproject.toml.

## Prerequisites

See [references/prerequisites.md](references/prerequisites.md) for gcloud/xpk/kubectl install steps.

## Troubleshooting

See [references/troubleshooting.md](references/troubleshooting.md) for common issues.
