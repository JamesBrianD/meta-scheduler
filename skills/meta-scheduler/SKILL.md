---
name: meta-scheduler
description: Manage remote Claude Code instances across SSH, K8s, and local workers using the `ms` CLI. Use when the user wants to dispatch tasks to remote machines, run Claude Code on a specific worker, interact with existing CC sessions (slots), manage environment variables for workers, deploy the agent binary, or check the status of running CC instances. Trigger phrases include "run this on [worker]", "dispatch to [machine]", "attach to slot", "check worker status", "setup worker", "deploy agent".
---

# Meta-Scheduler CLI (`ms`)

Manage Claude Code sessions (slots) on remote workers via SSH/kubectl/local. Uses a two-binary architecture: `ms` (local client) sends commands to `ms-agent` (deployed on each worker).

## Before acting

Run `ms list` to see current slot states. Run `ms worker list` to see available workers.

## Syntax

```bash
ms <command> [subcommand] [args] [--flags]
```

Run `ms help` or `ms <command> --help` for full options.

## Core operations

### Register a worker
```bash
ms worker add <name> --type ssh --host <h> --user <u> [--key <k>] [--max-slots <n>]
ms worker add <name> --type k8s --pod <pod> [--namespace <ns>] [--container <c>] [--max-slots <n>]
ms worker add <name> --type local [--max-slots <n>]
```

### Deploy ms-agent to a worker
```bash
ms worker setup <name>
```
Copies the `ms-agent` binary to the worker. Required for SSH/K8s workers before running slots. Local workers get it via `npm link`.

### Run a new slot (fresh CC instance)
```bash
ms run "<prompt>" --worker <name> [--name <label>] [--repo <git-url>] [--path <dir>]
```
The `ms` client sends the command to `ms-agent` on the worker, which creates a tmux session and starts Claude Code with the prompt.

### View slot logs/result
```bash
ms logs <slot-id>
```
Shows the result of a completed slot or streaming logs of a running one.

### Attach interactively
```bash
ms attach <slot-id>
```
Opens a live terminal session. If the slot is dead, automatically resumes with `claude --resume`. Detach with `Ctrl-B D`.

### Kill a slot
```bash
ms kill <slot-id>
```

### Manage environment variables
```bash
ms env set <key> <value> [--secret]
ms env remove <key>
ms env list
```
Env vars are injected into every slot. Use `--secret` to hide values in `ms env list`.

## Decision flow

1. `ms list` — check slot states
2. User references existing work → find matching slot:
   - `running` → `ms attach` for interactive, or `ms logs` to see output
   - `idle` → `ms attach` (auto-resumes)
   - `dead` → `ms attach` (auto-resumes with `claude --resume`)
3. User wants fresh work → `ms run --worker <w>`
4. User wants direct control → `ms attach`

## Common patterns

```bash
ms worker add dev-vm --type ssh --host 10.0.1.5 --user dev
ms worker setup dev-vm
ms env set ANTHROPIC_API_KEY sk-... --secret
ms run "fix the login bug" --worker dev-vm --repo git@github.com:user/app.git
ms list
ms logs <slot-id>
ms attach <slot-id>
ms kill <slot-id>
ms worker remove dev-vm
```

## Full reference

See [references/commands.md](references/commands.md) for all commands, flags, and options.
