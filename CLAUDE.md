# Meta-Scheduler

CLI tool for managing multiple Claude Code instances across remote workers (SSH, K8s, local).

## Build

```bash
npm install
npm run build
```

## Install CLI globally

```bash
npm run build && npm link
```

Both `ms` and `ms-agent` commands are now available globally.

## Architecture

Two-binary design:

- **`ms`** (client CLI) — runs locally, manages state in SQLite, sends structured commands to workers
- **`ms-agent`** (worker agent) — deployed on each worker, handles tmux/claude operations locally

```
ms (local) ──SSH/kubectl──> ms-agent (worker)
                              ├── tmux session management
                              ├── claude binary discovery
                              ├── log file reading
                              └── slot status reporting
```

This eliminates multi-layer shell escaping. The `ms` client sends `ms-agent run --id X --prompt Y` via the connector, and `ms-agent` handles everything locally with only one shell boundary.

- **ESM project** — `"type": "module"` in package.json, `module: "NodeNext"` in tsconfig
- **esbuild** bundles two entry points: `dist/cli.js` (ms) and `dist/agent-cli.js` (ms-agent)
- **better-sqlite3** is external for `ms` only (native addon). `ms-agent` has no native deps.
- **SQLite** at `~/.meta-scheduler/meta-scheduler.db` — all state stored here (client-side only)
- **Connectors** abstract SSH/local/K8s transport with `agentExec()`/`agentInteractive()` for structured agent calls

## Conventions

- All imports use `.js` extension (NodeNext module resolution)
- `better-sqlite3` calls are synchronous; connector calls are async
- IDs are 8-char UUID prefixes via `generateId()`
- `ms-agent` outputs JSON to stdout for `agentExec` parsing
- Env vars are passed inline as `--env-json` to each agent call

## Key files

- `src/cli.ts` — Client CLI entry point (commander.js)
- `src/db.ts` — SQLite singleton and schema
- `src/connectors/connector.ts` — Connector interface, factory, agentExec/agentInteractive
- `src/models/worker.ts` — Worker CRUD
- `src/models/slot.ts` — Thin client slot lifecycle (delegates to agent)
- `src/agent/agent-cli.ts` — Worker agent CLI entry point
- `src/agent/slot-manager.ts` — Agent-side tmux/claude/log operations

## Deploying ms-agent to workers

```bash
# Local worker: npm link handles it
ms worker add local-dev --type local

# SSH worker: deploy the binary
ms worker add dev-vm --type ssh --host 10.0.1.5 --user dev
ms worker setup dev-vm

# K8s worker: deploy the binary
ms worker add k8s-pod --type k8s --pod my-pod --namespace default
ms worker setup k8s-pod
```

## Testing

No automated tests yet. Test manually:

```bash
ms worker add local-dev --type local
ms worker list
ms run "echo hello" --worker local-dev --path /tmp
ms list
ms logs <slot-id>
ms attach <slot-id>
ms kill <slot-id>
ms worker remove local-dev
```
