# Meta-Scheduler Design Spec

A distributed CLI tool for managing multiple Claude Code instances across remote and local environments. The local scheduler dispatches tasks to workers (VMs, K8s pods, local machine) via SSH/kubectl, with each worker running Claude Code sessions inside tmux for persistence and interactive attach.

## Core Concepts

### Worker

A registered execution environment. Workers are manually prepared by the user; the scheduler only dispatches tasks to them.

| Field | Description |
|-------|-------------|
| name | Unique identifier (e.g., `gpu-vm`, `k8s-dev`, `local`) |
| type | `ssh`, `k8s`, or `local` |
| config | Connection details (host/user/key for SSH; namespace/pod for K8s) |
| max_slots | Maximum concurrent Claude Code sessions |

### Slot

A Claude Code session running on a worker inside a tmux session. A slot is the fundamental unit of execution and context.

| State | Description |
|-------|-------------|
| `running` | Claude Code is actively executing |
| `idle` | Claude Code has exited; tmux session and context preserved; can `resume` |
| `dead` | Session destroyed, no context |

A slot tracks:
- Which worker it lives on
- tmux session name
- Claude Code session ID (for `--resume`)
- Repository URL and working path
- Creation time and last activity time

### Task

A unit of work to be dispatched. Tasks can target:
- A **specific slot** (resume an idle slot or send to a running slot)
- A **specific worker** (create a new slot)

Tasks have optional priority and dependency support for batch dispatch via the queue.

## Architecture

```
+------------------------------------------+
|        Local Meta-Scheduler (CLI)         |
|                                           |
|  +----------+  +---------+  +----------+ |
|  | SQLite   |  | Worker  |  | Connector| |
|  | tasks    |  | Registry|  | Factory  | |
|  | slots    |  |         |  |          | |
|  +----+-----+  +----+----+  +----+-----+ |
|       +-------------+-----------+         |
|              Dispatcher                   |
+----------------+-------------------------+
                 | SSH / kubectl / local
    +------------+------------+
    |            |            |
+---v----+  +---v----+  +---v----+
| VM-1   |  | K8s    |  | Local  |
| tmux:  |  | Pod    |  | tmux:  |
| slot-1 |  | tmux:  |  | slot-5 |
| slot-2 |  | slot-3 |  +--------+
+--------+  | slot-4 |
            +--------+
```

## Connector Abstraction

All communication with workers goes through a Connector interface. This hides the transport mechanism (SSH, kubectl, local exec) from the rest of the system.

```typescript
interface Connector {
  // Execute a command on the worker, return stdout and exit code
  exec(command: string): Promise<{ stdout: string; stderr: string; code: number }>;

  // Open an interactive terminal session (for attach)
  interactive(command: string): void;

  // Connection type
  type: 'ssh' | 'k8s' | 'local';
}
```

### SSH Connector

```
exec(cmd)        → ssh user@host "cmd"
interactive(cmd) → ssh -t user@host "cmd"
```

### K8s Connector

```
exec(cmd)        → kubectl exec {pod} -n {ns} -- bash -c "cmd"
interactive(cmd) → kubectl exec -it {pod} -n {ns} -- cmd
```

### Local Connector

```
exec(cmd)        → child_process.exec(cmd)
interactive(cmd) → child_process.spawn with stdio: 'inherit'
```

## Slot Lifecycle

### Creating a new slot (`ms run`)

1. Scheduler picks the target worker based on CLI args
2. Creates a Connector for the worker
3. Remotely:
   - `git clone --branch main --single-branch {repo} /tmp/ms-slot-{id}` (if repo specified)
   - `tmux new-session -d -s slot-{id} 'cd {path} && claude -p "{prompt}" --dangerously-skip-permissions --output-format stream-json 2>&1 | tee /tmp/ms-slot-{id}.log'`
4. Records slot in SQLite with status `running`

### Resuming an idle slot (`ms resume`)

1. Look up slot in SQLite, verify status is `idle`
2. Create Connector for the slot's worker
3. Remotely:
   - `tmux send-keys -t slot-{id} 'claude --resume {session-id} -p "{prompt}" --dangerously-skip-permissions --output-format stream-json 2>&1 | tee -a /tmp/ms-slot-{id}.log' Enter`
4. Update slot status to `running`

### Sending to a running slot (`ms send`)

1. Look up slot, verify status is `running`
2. Create Connector
3. Remotely: `tmux send-keys -t slot-{id} "{message}" Enter`
4. This sends keystrokes to the active Claude Code session

**Note**: `tmux send-keys` sends raw keystrokes. This works when Claude Code is waiting for user input (e.g., permission prompts, plan approval). If CC is mid-execution, the keystrokes will be buffered by the terminal and processed when CC next reads stdin. For complex interactions, prefer `ms attach` for direct control.

### Attaching to a slot (`ms attach`)

1. Look up slot's worker
2. Create Connector
3. `connector.interactive("tmux attach -t slot-{id}")`
4. User is now in a live terminal session with Claude Code

### Checking slot status

Periodically or on-demand:
1. `connector.exec("tmux list-sessions -F '#{session_name}:#{pane_pid}:#{session_activity}'")`
2. For each slot, check if the CC process is still alive: `connector.exec("ps -p {pid}")`
3. If process is dead but tmux session exists → status = `idle`
4. If tmux session doesn't exist → status = `dead`
5. Update SQLite

## Task Queue

The task queue is an optional feature for batch dispatch. Core workflow works without it (`ms run`, `ms resume`, `ms send` are direct commands).

### Task fields

| Field | Type | Description |
|-------|------|-------------|
| id | int | Auto-increment |
| prompt | string | The task description / prompt |
| priority | enum | `critical`, `high`, `normal`, `low` |
| status | enum | `pending`, `dispatched`, `running`, `done`, `failed` |
| depends_on | int[] | Task IDs that must complete first |
| target_worker | string | Worker name (for new slot) |
| target_slot | string | Slot ID (for resume/send) |
| repo_url | string | Git repo URL (for new slot) |
| work_path | string | Working directory on remote |
| slot_id | string | Assigned slot (after dispatch) |
| pr_url | string | Created PR URL |
| created_at | datetime | |
| started_at | datetime | |
| completed_at | datetime | |

### Dispatch logic (`ms queue dispatch`)

```
1. Query tasks: status=pending, all depends_on tasks are done
2. Sort by priority (critical > high > normal > low), then by created_at
3. For each task:
   a. If target_slot specified and slot is idle → ms resume
   b. If target_slot specified and slot is running → ms send
   c. If target_worker specified → ms run (new slot)
   d. If neither → find worker with available capacity
4. Update task status to dispatched/running
```

## Data Model (SQLite)

```sql
CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ssh', 'k8s', 'local')),
  config_json TEXT NOT NULL,  -- {host, user, key} | {namespace, pod} | {}
  max_slots INTEGER DEFAULT 3,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE slots (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  tmux_session TEXT NOT NULL,
  cc_session_id TEXT,          -- Claude Code session ID for --resume
  repo_url TEXT,
  work_path TEXT NOT NULL,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'idle', 'dead')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt TEXT NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('critical', 'high', 'normal', 'low')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched', 'running', 'done', 'failed')),
  depends_on TEXT,             -- JSON array of task IDs
  target_worker TEXT,
  target_slot TEXT,
  repo_url TEXT,
  work_path TEXT,
  slot_id TEXT REFERENCES slots(id),
  pr_url TEXT,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME
);

CREATE TABLE task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER REFERENCES tasks(id),
  slot_id TEXT REFERENCES slots(id),
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  level TEXT DEFAULT 'info',
  message TEXT
);
```

## CLI Commands

```bash
# === Worker Management ===
ms worker add <name> --type ssh --host <h> --user <u> [--key <k>] [--max-slots <n>]
ms worker add <name> --type k8s --namespace <ns> --pod <p> [--max-slots <n>]
ms worker add <name> --type local [--max-slots <n>]
ms worker remove <name>
ms worker list

# === Direct Slot Operations ===
ms run "<prompt>" --worker <w> [--repo <url>] [--path <p>]     # New slot
ms resume <slot-id> "<prompt>"                                   # Resume idle slot
ms send <slot-id> "<prompt>"                                     # Message running slot
ms attach <slot-id>                                              # Interactive attach
ms kill <slot-id>                                                # Terminate slot
ms list                                                          # All slots with status
ms logs <slot-id> [--tail <n>]                                   # Read remote logs
ms status                                                        # Overview dashboard

# === Task Queue (batch) ===
ms queue add "<prompt>" [--worker <w>] [--slot <s>] [--repo <url>]
                        [--priority critical|high|normal|low]
                        [--depends-on <task-id>]
ms queue list
ms queue dispatch                                                # Dispatch pending tasks

# === PR Creation ===
ms pr <slot-id> [--title <t>]                                    # Commit + push + create PR
```

## PR Creation Flow (`ms pr`)

1. SSH into the worker
2. In the slot's working directory:
   ```bash
   cd {work_path}
   git add -A
   git commit -m "meta-scheduler: task {id} - {summary}"
   git push origin {branch}
   ```
3. Locally: `gh pr create --title "{title}" --body "..." --head {branch}`
4. Store PR URL in SQLite

## Project Structure

```
meta-scheduler/
├── src/
│   ├── cli.ts                  # CLI entry point (commander.js)
│   ├── db.ts                   # SQLite setup and queries
│   ├── models/
│   │   ├── worker.ts           # Worker CRUD
│   │   ├── slot.ts             # Slot lifecycle management
│   │   └── task.ts             # Task queue management
│   ├── connectors/
│   │   ├── connector.ts        # Connector interface
│   │   ├── ssh-connector.ts    # SSH implementation
│   │   ├── k8s-connector.ts    # kubectl implementation
│   │   └── local-connector.ts  # Local exec implementation
│   ├── dispatcher.ts           # Task → Slot matching and dispatch
│   └── git.ts                  # Git operations (clone, push, PR)
├── skills/
│   └── meta-scheduler/         # Claude Code skill (standard structure)
│       ├── SKILL.md            # Skill entry point
│       └── references/
│           └── commands.md     # Full command reference (progressive disclosure)
├── package.json
├── tsconfig.json
├── CLAUDE.md
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-03-29-meta-scheduler-design.md  (this file)
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI framework |
| `better-sqlite3` | SQLite driver |
| `@anthropic-ai/claude-agent-sdk` | Claude Code programmatic invocation (for local executor) |
| `chalk` | Terminal colors |

## Claude Code Skill

A single skill `meta-scheduler` teaches any Claude Code instance how to use the `ms` CLI. Follows the standard skill structure: `SKILL.md` + `references/commands.md` for progressive disclosure.

### Skill Directory

```
skills/meta-scheduler/
├── SKILL.md              # Core instructions (~700 words)
└── references/
    └── commands.md       # Full command reference with all flags
```

After building the CLI, install the skill so Claude Code auto-discovers it:
```bash
claude skills add ./skills/meta-scheduler
```

### SKILL.md Content

```markdown
---
name: meta-scheduler
description: Manage remote Claude Code instances across SSH, K8s, and local workers using the `ms` CLI. Use when the user wants to dispatch tasks to remote machines, run Claude Code on a specific worker, resume or interact with existing CC sessions (slots), manage a task queue with priorities and dependencies, or check the status of running CC instances. Trigger phrases include "run this on [worker]", "dispatch to [machine]", "resume slot", "attach to slot", "queue this task", "check worker status", "create PR from slot".
---

# Meta-Scheduler CLI (`ms`)

Manage Claude Code sessions (slots) on remote workers via SSH/kubectl/local.

## Before acting

Run `ms list` to see current slot states before choosing a command. Run `ms worker list` to see available workers.

## Syntax

```bash
ms <command> [subcommand] [args] [--flags]
```

Run `ms help` or `ms <command> --help` for full options.

## Core operations

### Run a new slot (fresh CC instance)
```bash
ms run "<prompt>" --worker <name> --repo <git-url> [--path <dir>]
```

### Resume an idle slot (keep full context)
```bash
ms resume <slot-id> "<prompt>"
```
Use when slot status is `idle` and the user wants to continue previous work.

### Send message to a running slot
```bash
ms send <slot-id> "<message>"
```
Use when slot status is `running` and CC is waiting for input.

### Attach interactively
```bash
ms attach <slot-id>
```

## Decision flow

1. `ms list` — check slot states
2. User references existing work → find matching slot:
   - `idle` → `ms resume`
   - `running` → `ms send`
3. User wants fresh work → `ms run --worker <w>`
4. User wants direct control → `ms attach`

## Common patterns

```bash
ms worker list                                          # See available workers
ms run "fix the login bug" --worker gpu-vm --repo git@github.com:user/app.git
ms list                                                 # Check all slot statuses
ms resume slot-2 "add tests for the fix"                # Continue on idle slot
ms attach slot-2                                        # Jump into live session
ms logs slot-2 --tail 20                                # Read recent output
ms pr slot-2 --title "Fix login bug"                    # Commit + push + PR
ms queue add "refactor auth" --worker gpu-vm --priority high
ms queue dispatch                                       # Dispatch queued tasks
```

## Full reference

See [references/commands.md](references/commands.md) for all commands, flags, and options.
```

### references/commands.md Content

A complete reference of all `ms` commands with every flag and option. Loaded only when Claude needs detailed flag info. Content tracks the CLI implementation — update this file whenever commands change.

Sections:
1. **Worker commands**: `ms worker add|remove|list` with all type-specific flags
2. **Slot commands**: `ms run|resume|send|attach|kill|list|logs|status` with all flags
3. **Queue commands**: `ms queue add|list|dispatch` with priority/dependency flags
4. **PR commands**: `ms pr` with title/body flags

### Skill Generation Rules

- The skill is generated at the end of Phase 1 with worker + slot commands
- Each subsequent phase updates the same skill (not separate files)
- `SKILL.md` stays under 700 words; new command details go into `references/commands.md`
- After updating, verify with `claude skills list` to confirm CC can discover it
- The `description` frontmatter must only contain trigger conditions, never workflow summaries

## Implementation Priority

Phase 1 (MVP):
1. SQLite schema + db.ts
2. Connector interface + SSH connector + local connector
3. Worker CRUD (add/remove/list)
4. Slot operations: `ms run`, `ms list`, `ms attach`, `ms kill`
5. Slot status checking
6. Generate `meta-scheduler` skill with worker + slot commands

Phase 2 (Context Reuse):
7. `ms resume` (idle slot reuse via claude --resume)
8. `ms send` (message running slot)
9. `ms logs`
10. Update skill: add resume/send/logs to SKILL.md and references/commands.md

Phase 3 (Task Queue):
11. Task CRUD + queue
12. Dispatcher (priority + dependency resolution)
13. `ms queue dispatch`
14. Update skill: add queue commands

Phase 4 (Polish):
15. `ms pr` (commit + push + PR creation)
16. K8s connector
17. `ms status` dashboard
18. Update skill with final command syntax, package with package_skill.py

## Open Questions

- How to reliably capture Claude Code's session ID from remote execution for `--resume`? Possible: parse the stream-json output for session info, or read `~/.claude/` on the remote.
- Should `ms attach` drop you into the tmux session directly, or into a wrapper that shows metadata first?
- Rate limiting: should the dispatcher respect API rate limits across all slots?
