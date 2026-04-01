# teardown & status

## teardown

```bash
# Delete workload only
xpk workload delete --workload <workload.name> \
  --cluster=<gke.cluster> --zone=<gke.zone> --project=<gke.project>

# Delete entire cluster (removes all workloads)
xpk cluster delete --cluster <gke.cluster> \
  --zone=<gke.zone> --project=<gke.project>
```

## status

```bash
# List workloads
xpk workload list --cluster=<gke.cluster> --zone=<gke.zone> --project=<gke.project>

# List pods
kubectl get pods

# Pod logs
kubectl logs <POD_NAME> -c <container>
```
