---
name: gke-tpu
description: Manage GKE-based TPU workloads — provision clusters, sync code, run benchmarks, profile kernels, and teardown. Use when the user wants to work with TPU on GKE. Reads config from gke.toml.
argument-hint: "<command> [args...]"
---

# GKE TPU Skill

Manage the full lifecycle of GKE-based TPU workloads via `xpk`. All cluster/project/TPU config comes from `gke.toml`.

## Commands

| Command | Description |
|---|---|
| `create` | Create cluster and/or workload |
| `sync` | Sync code and install dependencies to pod |
| `run` | Run a script on multi-process TPU |
| `profile` | Run with xprof LLO profiling enabled |
| `teardown` | Delete workload or cluster |
| `status` | Check pod/workload status |

---

## Configuration: `gke.toml`

The skill reads `.claude/gke.toml` (git-ignored). Create one before first use:

```toml
[gke]
project = "poc-tpu-partner"
cluster = "tpuv6e-256-node"
zone = "us-east5"

[tpu]
type = "v6e-256"        # TPU type for xpk
num_slices = 1
spot = true             # Use preemptible/spot instances

[workload]
name = "my-workload"    # Default workload name
docker_image = "us-docker.pkg.dev/cloud-tpu-images/jax-ai-image/tpu:jax0.8.1-rev1"

[repo]
# Code to sync to the pod
git_url = "https://github.com/sgl-project/sglang-jax.git"
remote_path = "/tmp/sglang-jax"
python_subdir = "python"        # subdirectory with installable package
install_cmd = "pip install --no-deps -e ."

[repo.deps]
# Runtime pip dependencies to install on pod
packages = [
    "pyzmq", "fastapi", "orjson", "uvicorn", "jinja2", "pydantic", "python-multipart",
    "huggingface-hub", "safetensors", "transformers", "tiktoken",
    "setproctitle", "psutil", "pandas", "httpx", "openai", "aiohttp",
    "pybase64", "partial_json_parser", "omegaconf",
    "msgpack-python", "requests", "typing-extensions",
]

[profile]
gcs_bucket = "gs://my-bucket/profile_tmp"   # For transferring large trace files
```

**The skill MUST read `gke.toml` at the start of every command** and substitute values into all `xpk`, `kubectl`, and script commands. Never hardcode project, cluster, zone, or TPU type.

---

## Prerequisites

```bash
# 1. Google Cloud SDK
brew install --cask google-cloud-sdk

# 2. kubectl + auth plugin
gcloud components install kubectl gke-gcloud-auth-plugin beta --quiet

# 3. xpk (must use Python 3.13, NOT 3.14 which has argparse incompatibility)
brew install pipx
pipx install xpk --python python3.13

# 4. Auth — use the project from gke.toml
gcloud auth login
gcloud config set project <project from gke.toml>
gcloud auth application-default login
```

**PATH setup** (needed in every shell/command):
```bash
export PATH="/Users/$(whoami)/.local/bin:/opt/homebrew/bin:/opt/homebrew/share/google-cloud-sdk/bin:/usr/bin:$PATH"
```

---

## `create` — Provision Cluster + Workload

### Step 1: Create Pathways Cluster (one-time, reusable)

```bash
xpk cluster create-pathways \
  --cluster <gke.cluster> \
  --num-slices=<tpu.num_slices> \
  --tpu-type=<tpu.type> \
  --zone=<gke.zone> \
  --spot \                          # if tpu.spot = true
  --project <gke.project>
```

### Step 2: Create Workload

**CRITICAL: Docker image must match pyproject.toml JAX version and have Python >= 3.12.**

Check available tags:
```bash
gcloud artifacts docker images list us-docker.pkg.dev/cloud-tpu-images/jax-ai-image/tpu \
  --include-tags --format="value(tags)" --project=<gke.project> \
  | tr ',' '\n' | grep -E "^jax" | sort -V
```

Create workload:
```bash
xpk workload create \
  --workload <workload.name> \
  --num-slices=<tpu.num_slices> \
  --tpu-type=<tpu.type> \
  --cluster=<gke.cluster> \
  --zone=<gke.zone> \
  --project=<gke.project> \
  --docker-name='<workload.name>' \
  --docker-image="<workload.docker_image>" \
  --command="sleep infinity"
```

Wait for pod ready:
```bash
kubectl get pods
kubectl wait --for=condition=Ready pod/<POD_NAME> --timeout=300s
```

---

## `sync` — Sync Code & Install Dependencies

**IMPORTANT: Multi-process TPU pods have multiple containers with independent filesystems. All setup must be done on ALL containers.**

Determine container count from TPU type:
- `v6e-256` → check `kubectl get pod <POD> -o jsonpath='{.spec.containers[*].name}'`
- `v7x-8` → 2 containers (`<name>-1`, `<name>-2`)

### Clone repo + install

```bash
for CONTAINER in <all containers>; do
  kubectl exec <POD_NAME> -c $CONTAINER -- bash -c '
    cd /tmp && git clone --depth 1 <repo.git_url>
    cd <repo_name>/<repo.python_subdir> && <repo.install_cmd>
  '
done
```

### Install runtime dependencies

```bash
for CONTAINER in <all containers>; do
  kubectl exec <POD_NAME> -c $CONTAINER -- pip install <repo.deps.packages joined by space>
done
```

### Push local code changes

```bash
for CONTAINER in <all containers>; do
  kubectl cp ./<repo.python_subdir>/sgl_jax <POD_NAME>:<repo.remote_path>/<repo.python_subdir>/sgl_jax -c $CONTAINER
  kubectl cp ./benchmark <POD_NAME>:<repo.remote_path>/benchmark -c $CONTAINER
done
```

---

## `run` — Execute on Multi-Process TPU

### Key Architecture Facts

- Multi-process TPU pods have multiple containers, each seeing a subset of devices
- `jax.distributed.initialize()` must be called in **all containers simultaneously**
- **CRITICAL: ALL processes must execute the SAME jitted computations.** If one process runs a sharded `jax.jit` call but another is sleeping, JAX will hang forever.

### Create launcher script

```python
#!/usr/bin/env python3
"""Launcher for multi-process TPU workloads."""
import os, sys

sys.path.insert(0, "<repo.remote_path>/<repo.python_subdir>")
sys.path.insert(0, "<repo.remote_path>")
os.chdir("<repo.remote_path>")

import jax
jax.distributed.initialize()
proc = jax.process_index()
print(f"[Process {proc}] ready, {jax.device_count()} devices", flush=True)

sys.argv = ["script_name", "--arg1", "val1", ...]
import runpy
runpy.run_path("<repo.remote_path>/path/to/script.py", run_name="__main__")
```

### Copy and launch on all containers

```bash
# Copy to all containers
for CONTAINER in <all containers>; do
  kubectl cp /tmp/launcher.py <POD_NAME>:/tmp/launcher.py -c $CONTAINER
done

# Launch worker containers in background
for WORKER in <all containers except first>; do
  kubectl exec <POD_NAME> -c $WORKER -- python3 -u /tmp/launcher.py 2>&1 &
done

# Launch main container in foreground
kubectl exec <POD_NAME> -c <first container> -- python3 -u /tmp/launcher.py 2>&1

# Cleanup background workers
wait
```

---

## `profile` — Kernel Profiling with xprof LLO

### LLO Utilization Reference

| LLO Row | What it shows |
|---|---|
| MXU | Matrix Unit utilization (matmuls) |
| Scalar ALU | Scalar arithmetic |
| Vector ALU | Vector arithmetic |
| Vector Load / Store | HBM <-> VMEM data movement |
| Vector Fills / Spills | VMEM spill traffic |
| XLU | Cross-Lane Unit (permutes, reductions) |

### The One Critical Rule

**`LIBTPU_INIT_ARGS` must be set BEFORE `import jax`.**

### Create profile_launcher.py

```python
#!/usr/bin/env python3
"""Launcher that sets LIBTPU_INIT_ARGS for xprof LLO tracing before importing JAX."""
import os, sys, runpy

_xla_flags = (
    "--xla_enable_custom_call_region_trace=true "
    "--xla_xprof_register_llo_debug_info=true"
)
existing = os.environ.get("LIBTPU_INIT_ARGS", "")
os.environ["LIBTPU_INIT_ARGS"] = (existing + " " + _xla_flags).strip()
print(f"LIBTPU_INIT_ARGS={os.environ['LIBTPU_INIT_ARGS']}", flush=True)

REPO_ROOT = "<repo.remote_path>"
sys.path.insert(0, os.path.join(REPO_ROOT, "<repo.python_subdir>"))
sys.path.insert(0, REPO_ROOT)
os.chdir(REPO_ROOT)

import jax
jax.distributed.initialize()
proc = jax.process_index()
print(f"[Process {proc}] JAX {jax.__version__}, {jax.device_count()} devices", flush=True)

script_path = os.path.join(REPO_ROOT, sys.argv[1])
sys.argv = [sys.argv[1]] + sys.argv[2:]
runpy.run_path(script_path, run_name="__main__")
```

### Transfer traces (use GCS — kubectl cp truncates > 50 MB)

```bash
# Upload from pod
kubectl exec $POD -c <first container> -- bash -c '
TRACE_DIR=$(find /tmp/profile_output -name "*.xplane.pb" -exec dirname {} \;)
gsutil cp ${TRACE_DIR}/*.xplane.pb <profile.gcs_bucket>/
gsutil cp ${TRACE_DIR}/*.trace.json.gz <profile.gcs_bucket>/
'

# Download to local
gsutil cp <profile.gcs_bucket>/*.xplane.pb ./profile_output/
gsutil cp <profile.gcs_bucket>/*.trace.json.gz ./profile_output/
```

### View in TensorBoard (must run on Linux pod)

```bash
# Install on pod
kubectl exec $POD -c <first container> -- pip install \
  'tensorflow>=2.21' 'tensorboard>=2.20' \
  'tensorboard-plugin-profile>=2.22' 'xprof>=2.22' \
  'protobuf>=5,<7' 'setuptools<81'

# Start TensorBoard
kubectl exec $POD -c <first container> -- bash -c "nohup python3 -c '
from tensorboard import main as tb
import sys
sys.argv = [\"tensorboard\", \"--logdir=/tmp/profile_output/\", \"--port=6006\", \"--bind_all\", \"--load_fast=false\"]
tb.run_main()
tb.main()
' > /tmp/tb.log 2>&1 &"

# Port-forward
kubectl port-forward $POD 6006:6006
```

Open **http://localhost:6006/** -> **Profile** -> **trace_viewer**.

---

## `teardown` — Delete Workload or Cluster

```bash
# Delete workload only
xpk workload delete --workload <workload.name> \
  --cluster=<gke.cluster> --zone=<gke.zone> --project=<gke.project>

# Delete entire cluster (removes all workloads)
xpk cluster delete --cluster <gke.cluster> \
  --zone=<gke.zone> --project=<gke.project>
```

---

## `status` — Check Current State

```bash
# List all workloads
xpk workload list --cluster=<gke.cluster> --zone=<gke.zone> --project=<gke.project>

# List pods
kubectl get pods

# Check pod logs
kubectl logs <POD_NAME> -c <container>
```

---

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| `SyntaxError` on `*` unpacking | Python < 3.12 | Use Docker image with Python >= 3.12 |
| `BooleanOptionalAction` error | xpk on Python 3.14 | `pipx reinstall xpk --python python3.13` |
| JAX TPU init hangs > 60s | Not all containers started | Must start all containers simultaneously |
| Sharded computation hangs | Worker not running same code | ALL processes must execute same jitted code paths |
| `Shutdown barrier DEADLINE_EXCEEDED` | One process crashed | Check crashed process logs, restart all |
| `ModuleNotFoundError` | Missing deps or PYTHONPATH | Ensure paths in sys.path |
| `gcloud auth` errors | Token expired | `gcloud auth login` |
| No LLO rows in profile | LIBTPU flags not set before JAX import | Use `profile_launcher.py` |
| `kubectl cp` truncated | Large file > 50 MB | Use GCS as intermediate |
| TensorBoard plugin error | Running on macOS | Run on Linux pod + port-forward |
