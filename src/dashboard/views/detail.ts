import type { AgentState, SupervisorState } from "../../supervisor/types.ts";
import { escapeHtml, page, relativeAge } from "./layout.ts";

export function renderDetail(state: SupervisorState, agent: AgentState): string {
  const resumeCmd = agent.sessionId
    ? `cd ${shellEscape(agent.home)} && claude --resume ${agent.sessionId}`
    : `cd ${shellEscape(agent.home)} && claude`;

  const body = `
    <header>
      <h1><a href="/" style="color:inherit;text-decoration:none">meta-scheduler</a> / ${escapeHtml(agent.name)}</h1>
      <span class="meta">probed: ${relativeAge(state.lastProbeAt)}</span>
      <a href="/api/state">JSON</a>
    </header>
    <main>
      <div class="panel">
        <h2>Status</h2>
        <dl class="kv">
          <dt>State</dt><dd><span class="status ${agent.status}">${agent.status}</span></dd>
          <dt>Home</dt><dd><code>${escapeHtml(agent.home)}</code></dd>
          <dt>Identity</dt><dd>${agent.hasIdentity ? "AGENTS.md ✓" : '<span style="color:var(--bad)">missing AGENTS.md</span>'}</dd>
          <dt>Inbox / Doing / Done</dt><dd>${agent.inboxCount} / ${agent.doingCount} / ${agent.doneCount}</dd>
          <dt>Session</dt><dd>${agent.sessionId ? `<code>${escapeHtml(agent.sessionId)}</code>` : '<span style="color:var(--muted)">no session yet</span>'}</dd>
          <dt>Last activity</dt><dd>${relativeAge(agent.lastActivityMs)}</dd>
        </dl>
      </div>

      <div class="panel">
        <h2>Resume command</h2>
        <div class="copy-row">
          <code id="resume-cmd">${escapeHtml(resumeCmd)}</code>
          <button type="button" onclick="copyResume()">Copy</button>
        </div>
      </div>

      <div class="panel">
        <h2>Drop a task into inbox</h2>
        <form method="post" action="/agent/${encodeURIComponent(agent.name)}/inbox" enctype="application/x-www-form-urlencoded">
          <div class="row">
            <label for="filename">Filename (will be saved as <code>inbox/&lt;NN&gt;-&lt;name&gt;.md</code>)</label>
            <input type="text" id="filename" name="filename" placeholder="e.g. 05-clean-up-old-logs" required>
          </div>
          <div class="row">
            <label for="content">Markdown body</label>
            <textarea id="content" name="content" placeholder="# Task: ..." required></textarea>
          </div>
          <input type="submit" value="Drop into inbox">
        </form>
      </div>

      <div class="panel">
        <h2>Live session log <span style="font-weight:400;color:var(--muted);font-size:12px;">(SSE tail)</span></h2>
        ${agent.sessionFile
          ? `<pre class="log" id="logbox">(connecting…)</pre>
            <script>
              const box = document.getElementById('logbox');
              box.textContent = '';
              const es = new EventSource('/agent/${encodeURIComponent(agent.name)}/tail');
              es.onmessage = (e) => {
                const wasNearBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
                box.textContent += e.data + '\\n';
                if (wasNearBottom) box.scrollTop = box.scrollHeight;
              };
              es.onerror = () => { box.textContent += '\\n[stream disconnected]\\n'; };
            </script>`
          : `<p style="color:var(--muted);margin:0">No session file yet. Boot the agent with the resume command above (or just <code>claude</code>) and refresh.</p>`}
      </div>
    </main>
    <script>
      function copyResume() {
        const el = document.getElementById('resume-cmd');
        navigator.clipboard.writeText(el.textContent).then(() => {
          const btn = event.target;
          const old = btn.textContent;
          btn.textContent = 'Copied';
          setTimeout(() => { btn.textContent = old; }, 1200);
        });
      }
    </script>
  `;
  return page(`${agent.name} — meta-scheduler`, body);
}

function shellEscape(s: string): string {
  if (/^[A-Za-z0-9_./@:-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
