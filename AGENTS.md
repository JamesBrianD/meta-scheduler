# Meta-Scheduler

Infrastructure for managing **persistent Claude Code agents** — long-running CC processes that live across time, each anchored to a directory in a *vault*, with their own tasks and memory.

> **Status: redesign transition.** The original two-binary remote-dispatch implementation (`ms` / `ms-agent` over SSH/k8s) has been removed (commit on 2026-05-24). The repo is currently a near-empty shell — only `private/` (vault content), `skills/`, and minimal TS scaffolding remain. The v2 supervisor and dashboard land in fresh modules here. See `private/specs/2026-05-24-meta-scheduler-redesign.md` for the new model.

## What this is

A persistent agent is a CC process bound to its own directory. It reads `AGENTS.md` to learn its role, pulls tasks from its own `inbox/`, executes, writes results to `notes/` and `log/`, and self-loops via `/loop` (cron mode — see the redesign spec, Q1, for why dynamic mode is unavailable in our environment).

The **vault** is the file-system layout that holds those agent directories. The vault is the contract; the rest of this repo is the surrounding infrastructure (boot scaffolding, supervisor, dashboard) that makes operating a fleet of agents practical.

## Vault layout

```
private/
├── agents/
│   ├── meta-scheduler-dev/      # First agent (v1; dogfoods this redesign)
│   │   ├── AGENTS.md             # Identity & work loop
│   │   ├── inbox/                # Pending tasks (one .md per task)
│   │   ├── doing/                # In-progress tasks
│   │   ├── done/                 # Completed tasks
│   │   ├── log/                  # Auto-written work log (per-day)
│   │   └── notes/                # Long-term memory (agent-curated)
│   └── <future-agents>/          # sgl-jax-main, tpu-profiler, chief-of-staff, …
└── work/                         # Public cross-agent area (not auto-loaded)
    ├── codewiki/  specs/  plans/  daily/
```

Every agent has the same five subdirs (`inbox/ doing/ done/ log/ notes/`). Tasks move through `inbox → doing → done` as markdown files; the operator (or another agent) injects work by dropping files into `inbox/`.

## Public vs private split

This repo is intended for open-source release once v2 ships. The boundary is enforced by the existing submodule:

- **`meta-scheduler/`** (public, this repo): infrastructure code — vault schema, agent boot scaffolding, future supervisor and dashboard, conventions documented here. No personal content.
- **`meta-scheduler/private/`** (private submodule, `JamesBrianD/private-notes`): vault contents — agent identities, notes, in-progress tasks. Never committed to the public repo.

After cloning, run `git submodule update --init` to pull private content. Anyone adopting the public project plugs in their own private vault under `private/`.

## Skills

`skills/` (e.g. `gke-tpu`, `sync`) are independent CC skills that pre-date the redesign and remain useful. They are not part of the agent-vault model and stay as-is.

## Roadmap

- **v1 — validate the model.** Bootstrap a single agent (`meta-scheduler-dev`) whose first job is to help build v2 by dogfooding the persistent-agent + vault primitive. Manual task injection via filesystem; no dashboard, no supervisor. *We are here.*
- **v2 — make it usable.** A *supervisor* (detects hung CC processes, restarts on network recovery) and a *dashboard* (web/Mac app reading vault state — per-agent status, inbox depth, last activity, copy-to-clipboard `claude --resume` command). A second agent to validate isolation between agents.
- **v3 — delegation & remote control.** A *Chief of Staff* agent with permission to write into other agents' inboxes (just another agent — no special infra). Feishu integration via existing `cc-connect` so the operator can triage from mobile; the master agent delegates to specialists.

## What this replaces (history note)

Earlier iterations of this repo shipped `ms` (a local CLI) and `ms-agent` (a worker-side binary deployed via SSH/k8s) — a remote-dispatch design where the operator dispatched tasks to CC processes running on remote machines. That abstraction was wrong: the meaningful axis is *time* (agents that own goals and memory across sessions), not *space* (where the process happens to run). CC's own primitives (`/loop`, `ScheduleWakeup`, durable threads) already cover the temporal axis, so the remote-dispatch layer is being deleted in favor of the local-vault model described above.

## Working in this repo

- New work belongs in `private/agents/<name>/` (vault content) or — once v2 starts — in fresh public modules for the supervisor and dashboard.
- See `private/agents/meta-scheduler-dev/HOW-TO-BOOT.md` for booting an agent in a terminal.
- See `private/specs/2026-05-24-meta-scheduler-redesign.md` for the full design rationale and open questions.
- See `private/agents/meta-scheduler-dev/notes/supervisor-design.md` for the v2 supervisor design.
