# create — Create TPU Workload

Determine single-host vs multi-host from topology, then apply the correct YAML template.

## Step 1: Connect to cluster

```bash
gcloud container clusters get-credentials <gke.cluster> --zone=<gke.zone> --project=<gke.project>
```

## Step 2: Choose template

Calculate hosts: total chips in topology / `tpu.chips_per_node`.
- **1 host** → Single-host Pod template
- **>1 hosts** → Multi-host Job template (requires headless Service)

## Single-host Pod Template

For topologies with 1 host (e.g. `2x2` with 4 chips on v6e).

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: <workload.name>
  annotations:
    gke-gcsfuse/volumes: "true"
spec:
  restartPolicy: Never
  nodeSelector:
    cloud.google.com/gke-tpu-accelerator: <tpu.accelerator>
    cloud.google.com/gke-tpu-topology: <tpu.topology>
  containers:
  - name: <workload.name>
    image: <workload.docker_image>
    command: ["sleep", "infinity"]
    resources:
      requests:
        google.com/tpu: <tpu.chips_per_node>
      limits:
        google.com/tpu: <tpu.chips_per_node>
    volumeMounts:
    - name: gcs-fuse-csi-ephemeral
      mountPath: <storage.mount_path>
      readOnly: false
    - name: dev-shm
      mountPath: /dev/shm
  serviceAccountName: <workload.service_account>
  volumes:
  - name: dev-shm
    emptyDir:
      medium: Memory
  - name: gke-gcsfuse-cache
    emptyDir:
      medium: Memory
  - name: gcs-fuse-csi-ephemeral
    csi:
      driver: gcsfuse.csi.storage.gke.io
      readOnly: false
      volumeAttributes:
        skipCSIBucketAccessCheck: "true"
        gcsfuseMetadataPrefetchOnMount: "true"
        bucketName: <storage.bucket>
        mountOptions: "<storage.mount_options>"
```

## Multi-host Job Template

For topologies with >1 host (e.g. `4x4` = 16 chips = 4 hosts on v6e).

Requires a headless Service for inter-host communication. `parallelism` and `completions` = number of hosts.

```yaml
---
apiVersion: v1
kind: Service
metadata:
  name: <workload.name>-headless-svc
spec:
  clusterIP: None
  selector:
    job-name: <workload.name>
---
apiVersion: batch/v1
kind: Job
metadata:
  name: <workload.name>
spec:
  completionMode: Indexed
  parallelism: <num_hosts>
  completions: <num_hosts>
  backoffLimit: 0
  template:
    metadata:
      annotations:
        gke-gcsfuse/volumes: "true"
    spec:
      subdomain: <workload.name>-headless-svc
      restartPolicy: Never
      nodeSelector:
        cloud.google.com/gke-tpu-accelerator: <tpu.accelerator>
        cloud.google.com/gke-tpu-topology: <tpu.topology>
      containers:
      - name: <workload.name>
        image: <workload.docker_image>
        command: ["sleep", "infinity"]
        resources:
          requests:
            google.com/tpu: <tpu.chips_per_node>
          limits:
            google.com/tpu: <tpu.chips_per_node>
        volumeMounts:
        - name: gcs-fuse-csi-ephemeral
          mountPath: <storage.mount_path>
          readOnly: false
        - name: dev-shm
          mountPath: /dev/shm
      serviceAccountName: <workload.service_account>
      volumes:
      - name: dev-shm
        emptyDir:
          medium: Memory
      - name: gke-gcsfuse-cache
        emptyDir:
          medium: Memory
      - name: gcs-fuse-csi-ephemeral
        csi:
          driver: gcsfuse.csi.storage.gke.io
          readOnly: false
          volumeAttributes:
            skipCSIBucketAccessCheck: "true"
            gcsfuseMetadataPrefetchOnMount: "true"
            bucketName: <storage.bucket>
            mountOptions: "<storage.mount_options>"
```

## Step 3: Apply and wait

```bash
kubectl apply -f /tmp/<workload.name>.yaml

# For Pod:
kubectl wait --for=condition=Ready pod/<workload.name> --timeout=300s

# For Job:
kubectl get pods -l job-name=<workload.name> --watch
```

## Step 4: Verify

```bash
# List containers
kubectl get pod <POD_NAME> -o jsonpath='{.spec.containers[*].name}'

# Check TPU devices
kubectl exec <POD_NAME> -c <container> -- python3 -c "import jax; print('TPU devices:', jax.device_count())"
```
