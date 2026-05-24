import type { AgentState, SupervisorState } from "../../supervisor/types.ts";
import type { Project } from "../sessions.ts";
import { escapeHtml, relativeAge, renderSidebar, shell, statusBadge } from "./layout.ts";

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

function agentRow(agent: AgentState): string {
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

function apiProbeBadge(state: SupervisorState): string {
  const p = state.apiProbe;
  const color = p.status === "ok" ? "var(--ok)" : p.status === "down" ? "var(--bad)" : "var(--muted)";
  const label = p.status === "ok"
    ? `api ok${p.consecutiveOkMs >= 60_000 ? " · gate open" : ""}`
    : p.status === "down"
      ? `api down`
      : "api unknown";
  return `<span class="heartbeat" style="color:${color}"><span style="width:7px;height:7px;border-radius:50%;background:${color};"></span>${label}</span>`;
}

function restartBadge(state: SupervisorState): string {
  const on = state.restartEnabled;
  return `<span class="heartbeat" style="color:${on ? "var(--accent)" : "var(--muted)"};font-size:11.5px;">restart ${on ? "ENABLED" : "off"}</span>`;
}

function heartbeatBadge(state: SupervisorState): string {
  const ok = !!(state.lastProbeAt && Date.now() - state.lastProbeAt < 60_000);
  return ok
    ? `<span class="heartbeat"><span style="width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent);"></span>supervisor live · ${relativeAge(state.lastProbeAt)}</span>`
    : `<span class="heartbeat" style="color:var(--bad)"><span style="width:7px;height:7px;border-radius:50%;background:var(--bad);"></span>supervisor stalled</span>`;
}

function heartbeatLabel(state: SupervisorState): { ok: boolean; label: string } {
  const ok = !!(state.lastProbeAt && Date.now() - state.lastProbeAt < 60_000);
  return {
    ok,
    label: ok
      ? `supervisor live · ${relativeAge(state.lastProbeAt)}`
      : "supervisor stalled",
  };
}

export function renderHome(state: SupervisorState, projects: Project[]): string {
  const hb = heartbeatLabel(state);
  const sidebar = renderSidebar({
    projects,
    heartbeatOk: hb.ok,
    heartbeatLabel: hb.label,
  });

  const agentSection = state.agents.length === 0
    ? `<div class="empty">No agents in <code>${escapeHtml(state.vaultDir)}</code>. Drop <code>&lt;name&gt;/AGENTS.md</code> to register one.</div>`
    : `<div class="agent-grid">${state.agents.map(agentRow).join("")}</div>`;

  const totalSessions = projects.reduce((n, p) => n + p.sessionCount, 0);

  const content = `
    <header class="bar">
      <h1>Home</h1>
      <span class="meta">${projects.length} projects · ${totalSessions} sessions</span>
      <div class="right">
        ${restartBadge(state)}
        ${apiProbeBadge(state)}
        ${heartbeatBadge(state)}
        <a href="/api/state">JSON</a>
      </div>
    </header>
    <main>
      <div class="card">
        <h2>Supervised agents · vault <code style="font-size:11.5px">${escapeHtml(state.vaultDir)}</code></h2>
        ${agentSection}
      </div>

      <div class="card">
        <h2>Quick start</h2>
        <div style="color:var(--fg-soft);font-size:13.5px;line-height:1.6;">
          Pick a project from the sidebar to browse its sessions. Click a session to read its transcript and copy a <code>claude --resume</code> command.
        </div>
      </div>
    </main>
    <script>setTimeout(() => location.reload(), 15000);</script>
  `;

  return shell("meta-scheduler", sidebar, content);
}

export function renderProject(state: SupervisorState, projects: Project[], project: Project): string {
  const hb = heartbeatLabel(state);
  const sidebar = renderSidebar({
    projects,
    activeProjectDir: project.dirName,
    heartbeatOk: hb.ok,
    heartbeatLabel: hb.label,
  });

  const list = project.sessions.length === 0
    ? `<div class="empty">No sessions.</div>`
    : `<div class="session-list">${project.sessions.map((s) => `
        <div class="session-card">
          <a href="/session/${encodeURIComponent(project.dirName)}/${encodeURIComponent(s.id)}">
            <span class="session-card-title">${escapeHtml(s.title)}</span>
            <span class="session-card-meta">${relativeAge(s.lastActivityMs)} · ${formatBytes(s.sizeBytes)}</span>
          </a>
        </div>
      `).join("")}</div>`;

  const content = `
    <header class="bar">
      <h1><a href="/" style="color:inherit">Home</a> <span class="crumb">/</span> ${escapeHtml(project.displayName)}</h1>
      <span class="meta"><code>${escapeHtml(project.cwd)}</code></span>
      <div class="right">
        <span class="heartbeat">${project.sessionCount} sessions</span>
      </div>
    </header>
    <main>
      ${list}
    </main>
  `;

  return shell(`${project.displayName} · meta-scheduler`, sidebar, content);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
