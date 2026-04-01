# create — Provision Cluster and/or Workload

First check what already exists, then only create what's needed.

## Step 1: Check existing state

```bash
# Check if cluster exists
gcloud container clusters list --project=<gke.project> --zone=<gke.zone> \
  --filter="name=<gke.cluster>" --format="value(name)"

# Check existing workloads
xpk workload list --cluster=<gke.cluster> --zone=<gke.zone> --project=<gke.project>
```

- **Cluster exists + workload exists** → skip to "Wait for pod ready"
- **Cluster exists + no workload** → skip to "Create Workload"
- **No cluster** → start from "Create Cluster"

## Step 2: Create Cluster (skip if already exists)

One-time setup, reusable across workloads.

```bash
# Add --spot if tpu.spot = true
xpk cluster create-pathways \
  --cluster <gke.cluster> \
  --num-slices=<tpu.num_slices> \
  --tpu-type=<tpu.type> \
  --zone=<gke.zone> \
  --spot \
  --project <gke.project>
```

## Step 3: Create Workload (skip if already exists)

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

## Step 4: Wait for pod ready

```bash
kubectl get pods
kubectl wait --for=condition=Ready pod/<POD_NAME> --timeout=300s
```

Determine container names: `kubectl get pod <POD> -o jsonpath='{.spec.containers[*].name}'`
