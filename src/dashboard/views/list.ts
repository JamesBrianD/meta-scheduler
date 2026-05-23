import type { SupervisorState } from "../../supervisor/types.ts";
import { escapeHtml, page, relativeAge } from "./layout.ts";

export function renderList(state: SupervisorState): string {
  const rows = state.agents.map((a) => `
    <tr>
      <td><a href="/agent/${encodeURIComponent(a.name)}">${escapeHtml(a.name)}</a></td>
      <td><span class="status ${a.status}">${a.status}</span></td>
      <td class="num">${a.inboxCount}</td>
      <td class="num">${a.doingCount}</td>
      <td class="num">${a.doneCount}</td>
      <td>${relativeAge(a.lastActivityMs)}</td>
    </tr>
  `).join("");

  const empty = state.agents.length === 0
    ? `<p style="color: var(--muted); padding: 20px 0;">No agents found in <code>${escapeHtml(state.vaultDir)}</code>.</p>`
    : "";

  const body = `
    <header>
      <h1>meta-scheduler</h1>
      <span class="meta">vault: <code>${escapeHtml(state.vaultDir)}</code></span>
      <span class="meta">probed: ${relativeAge(state.lastProbeAt)}</span>
      <a href="/api/state">JSON</a>
    </header>
    <main>
      ${empty || `
      <table>
        <thead>
          <tr>
            <th>Agent</th><th>Status</th>
            <th style="text-align:right">Inbox</th>
            <th style="text-align:right">Doing</th>
            <th style="text-align:right">Done</th>
            <th>Last activity</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      `}
    </main>
    <script>setTimeout(() => location.reload(), 5000);</script>
  `;
  return page("meta-scheduler", body);
}
