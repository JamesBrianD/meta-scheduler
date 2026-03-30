# Meta-Scheduler Command Reference

## Worker Commands

### `ms worker add <name>`

Register a new worker.

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--type <type>` | Yes | - | Worker type: `ssh`, `k8s`, or `local` |
| `--host <host>` | SSH only | - | SSH hostname or IP |
| `--user <user>` | SSH only | - | SSH username |
| `--key <key>` | No | - | Path to SSH private key |
| `--pod <pod>` | K8s only | - | K8s pod name |
| `--namespace <ns>` | No | `default` | K8s namespace |
| `--container <c>` | No | - | K8s container name |
| `--max-slots <n>` | No | 3 | Maximum concurrent CC slots |

```bash
ms worker add gpu-vm --type ssh --host 10.0.1.5 --user dev --max-slots 5
ms worker add k8s-pod --type k8s --pod my-pod --namespace default
ms worker add local-dev --type local
```

### `ms worker remove <name>`

Remove a registered worker. Fails if worker has active (running/idle) slots.

```bash
ms worker remove gpu-vm
```

### `ms worker list`

List all registered workers with connection info and status.

```bash
ms worker list
```

### `ms worker setup <name>`

Deploy the `ms-agent` binary to a remote worker. Required before running slots on SSH/K8s workers.

- **Local**: Verifies `ms-agent` is in PATH (installed via `npm link`)
- **SSH**: Copies `dist/agent-cli.js` to `~/.local/bin/ms-agent` via scp
- **K8s**: Copies `dist/agent-cli.js` to `/usr/local/bin/ms-agent` via kubectl cp

```bash
ms worker setup dev-vm
ms worker setup k8s-pod
```

## Environment Variable Commands

### `ms env set <key> <value>`

Set an environment variable to inject into all slots.

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--secret` | No | false | Hide value in `ms env list` output |

```bash
ms env set ANTHROPIC_API_KEY sk-ant-... --secret
ms env set ANTHROPIC_BASE_URL https://api.anthropic.com
```

### `ms env remove <key>`

Remove an environment variable.

```bash
ms env remove ANTHROPIC_API_KEY
```

### `ms env list`

List all configured environment variables. Secret values are masked.

```bash
ms env list
```

## Slot Commands

### `ms run <prompt>`

Start a new Claude Code instance on a worker. The `ms` client sends a structured command to `ms-agent` on the worker, which creates a tmux session and runs Claude Code.

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--worker <name>` | Yes | - | Target worker name |
| `--name <name>` | No | prompt preview | Human-readable slot label |
| `--repo <url>` | No | - | Git repo to clone before starting |
| `--path <path>` | No | cloned repo or `~` | Working directory on the worker |

```bash
ms run "implement user auth" --worker gpu-vm --repo git@github.com:user/app.git
ms run "fix the bug in main.ts" --worker local-dev --path /Users/me/project --name "bugfix"
```

### `ms list`

List all active slots. Automatically syncs status from workers via `ms-agent` before displaying. Dead slots are hidden by default.

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--all` | No | false | Include dead slots |

Statuses:
- **running** — Claude Code is actively executing
- **idle** — Claude Code process exited but tmux session alive
- **dead** — tmux session gone

```bash
ms list
ms list --all
```

### `ms logs <slot-id>`

Show the result or streaming logs of a slot. Reads the log file on the worker via `ms-agent`.

```bash
ms logs a1b2c3d4
```

### `ms attach <slot-id>`

Attach to a slot's tmux session for interactive use. If the slot is dead and has a session ID in its logs, automatically resumes with `claude --resume`. Detach with `Ctrl-B D`.

```bash
ms attach a1b2c3d4
```

### `ms kill <slot-id>`

Terminate a slot's tmux session and mark it as dead.

```bash
ms kill a1b2c3d4
```
