import type { AgentState, SupervisorState } from "../../supervisor/types.ts";
import { escapeHtml, page, relativeAge, statusBadge } from "./layout.ts";

function currentTaskCell(agent: AgentState): string {
  if (agent.doingTasks.length === 0) {
    return `<div class="current empty">idle</div>`;
  }
  if (agent.doingTasks.length === 1) {
    const t = agent.doingTasks[0];
    return `<div class="current" title="${escapeHtml(t.filename)}">${escapeHtml(t.prettyName)}</div>`;
  }
  const first = agent.doingTasks[0];
  return `<div class="current" title="${agent.doingTasks.map((t) => escapeHtml(t.filename)).join(", ")}">${escapeHtml(first.prettyName)} <span style="color:var(--muted)">+${agent.doingTasks.length - 1}</span></div>`;
}

function row(agent: AgentState): string {
  return `
    <div class="agent-row">
      <div class="name"><a href="/agent/${encodeURIComponent(agent.name)}">${escapeHtml(agent.name)}</a></div>
      ${statusBadge(agent.status)}
      ${currentTaskCell(agent)}
      <div class="counts">
        <span><b>${agent.inboxCount}</b> inbox</span>
        <span><b>${agent.doingCount}</b> doing</span>
        <span><b>${agent.doneCount}</b> done</span>
      </div>
      <div class="age">${relativeAge(agent.lastActivityMs)}</div>
    </div>
  `;
}

export function renderList(state: SupervisorState): string {
  const heartbeat = state.lastProbeAt && Date.now() - state.lastProbeAt < 60_000
    ? `<span class="heartbeat"><span style="width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent);"></span>supervisor live · probed ${relativeAge(state.lastProbeAt)}</span>`
    : `<span class="heartbeat" style="color:var(--bad)"><span style="width:7px;height:7px;border-radius:50%;background:var(--bad);"></span>supervisor stalled</span>`;

  const list = state.agents.length === 0
    ? `<div class="empty">No agents found in <code>${escapeHtml(state.vaultDir)}</code>. Create <code>&lt;name&gt;/AGENTS.md</code> under the vault dir to register one.</div>`
    : `<div class="agent-grid">${state.agents.map(row).join("")}</div>`;

  const body = `
    <header class="bar">
      <h1>meta-scheduler</h1>
      <span class="meta">vault <code>${escapeHtml(state.vaultDir)}</code></span>
      <div class="right">
        ${heartbeat}
        <a href="/api/state">JSON</a>
      </div>
    </header>
    <main>
      ${list}
    </main>
    <script>setTimeout(() => location.reload(), 5000);</script>
  `;
  return page("meta-scheduler", body);
}
