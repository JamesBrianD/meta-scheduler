# profile — Kernel Profiling with xprof LLO

## LLO Utilization Reference

| LLO Row | What it shows |
|---|---|
| MXU | Matrix Unit utilization (matmuls) |
| Scalar ALU | Scalar arithmetic |
| Vector ALU | Vector arithmetic |
| Vector Load / Store | HBM <-> VMEM data movement |
| Vector Fills / Spills | VMEM spill traffic |
| XLU | Cross-Lane Unit (permutes, reductions) |

## Critical: Set LIBTPU_INIT_ARGS BEFORE `import jax`

```python
#!/usr/bin/env python3
"""profile_launcher.py — sets LIBTPU flags before JAX import."""
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

## Benchmark --profile pattern

```python
if profile:
    os.makedirs(profile_dir, exist_ok=True)
    for _ in range(warmup_iters):
        out = compute(); jax.block_until_ready(out)
    with jax.profiler.trace(profile_dir):
        for step in range(iters):
            with jax.profiler.StepTraceAnnotation("kernel", step_num=step):
                out = compute(); jax.block_until_ready(out)
```

## Transfer traces

Use GCS — `kubectl cp` truncates files > 50 MB.

```bash
# Upload from pod
kubectl exec $POD -c <first container> -- bash -c '
TRACE_DIR=$(find /tmp/profile_output -name "*.xplane.pb" -exec dirname {} \; | head -n 1)
gsutil cp ${TRACE_DIR}/*.xplane.pb <profile.gcs_bucket>/
gsutil cp ${TRACE_DIR}/*.trace.json.gz <profile.gcs_bucket>/
'

# Download to local
gsutil cp <profile.gcs_bucket>/*.xplane.pb ./profile_output/
gsutil cp <profile.gcs_bucket>/*.trace.json.gz ./profile_output/
```

## View in TensorBoard (must run on Linux pod)

```bash
# Install
kubectl exec $POD -c <first container> -- pip install \
  'tensorflow>=2.21' 'tensorboard>=2.20' \
  'tensorboard-plugin-profile>=2.22' 'xprof>=2.22' \
  'protobuf>=5,<7' 'setuptools<81'

# Start
kubectl exec $POD -c <first container> -- bash -c "nohup python3 -c '
from tensorboard import main as tb; import sys
sys.argv = [\"tensorboard\", \"--logdir=/tmp/profile_output/\", \"--port=6006\", \"--bind_all\", \"--load_fast=false\"]
tb.run_main(); tb.main()
' > /tmp/tb.log 2>&1 &"

# Port-forward
kubectl port-forward $POD 6006:6006
```

Keys: **W/S** zoom, **A/D** pan, **1** select, **4** timing.
