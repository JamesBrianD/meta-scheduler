# sync — Sync Code & Install Dependencies

All commands must run on ALL containers (multi-process TPU pods have independent filesystems).

## Clone repo + install

```bash
for CONTAINER in <all containers>; do
  kubectl exec <POD_NAME> -c $CONTAINER -- bash -c '
    cd /tmp && git clone --depth 1 <repo.git_url>
    cd <repo_name>/<repo.python_subdir> && <repo.install_cmd>
  '
done
```

## Install runtime dependencies

```bash
for CONTAINER in <all containers>; do
  kubectl exec <POD_NAME> -c $CONTAINER -- pip install <repo.deps.packages joined by space>
done
```

## Push local code changes

```bash
for CONTAINER in <all containers>; do
  kubectl cp ./<repo.python_subdir>/sgl_jax <POD_NAME>:<repo.remote_path>/<repo.python_subdir>/sgl_jax -c $CONTAINER
  kubectl cp ./benchmark <POD_NAME>:<repo.remote_path>/benchmark -c $CONTAINER
done
```
