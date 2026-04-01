# create — Provision Cluster + Workload

## Step 1: Create Pathways Cluster (one-time, reusable)

```bash
xpk cluster create-pathways \
  --cluster <gke.cluster> \
  --num-slices=<tpu.num_slices> \
  --tpu-type=<tpu.type> \
  --zone=<gke.zone> \
  --spot \                          # if tpu.spot = true
  --project <gke.project>
```

## Step 2: Create Workload

Docker image must match pyproject.toml JAX version (Python >= 3.12).

Check available tags:
```bash
gcloud artifacts docker images list us-docker.pkg.dev/cloud-tpu-images/jax-ai-image/tpu \
  --include-tags --format="value(tags)" --project=<gke.project> \
  | tr ',' '\n' | grep -E "^jax" | sort -V
```

| pyproject.toml JAX | Docker image tag |
|---|---|
| `jax==0.8.1` | `jax0.8.1-rev1` |
| `jax==0.9.0` | `jax0.9.0-rev1` |

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

## Step 3: Wait for pod ready

```bash
kubectl get pods
kubectl wait --for=condition=Ready pod/<POD_NAME> --timeout=300s
```

Determine container names: `kubectl get pod <POD> -o jsonpath='{.spec.containers[*].name}'`
