import type { AgentState, SupervisorState } from "../../supervisor/types.ts";
import { escapeHtml, page, relativeAge, statusBadge } from "./layout.ts";

function shellEscape(s: string): string {
  if (/^[A-Za-z0-9_./@:-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function currentTaskPanel(agent: AgentState): string {
  if (agent.doingTasks.length === 0) {
    return `
      <div class="card">
        <h2>Currently working on</h2>
        <div style="color: var(--muted); font-size: 13.5px;">No task in <code>doing/</code>. Agent is idle or between tasks.</div>
      </div>
    `;
  }
  const items = agent.doingTasks.map((t) => `
    <li>
      <span class="pulse"></span>
      <span class="label">${escapeHtml(t.prettyName)}</span>
      <span class="file">${escapeHtml(t.filename)}</span>
    </li>
  `).join("");
  return `
    <div class="card">
      <h2>Currently working on</h2>
      <ul class="task-list">${items}</ul>
    </div>
  `;
}

function inboxPanel(agent: AgentState): string {
  if (agent.inboxTasks.length === 0) {
    return `
      <div class="card">
        <h2>Inbox queue</h2>
        <div style="color: var(--muted); font-size: 13.5px;">Empty. Drop a task below to add work.</div>
      </div>
    `;
  }
  const items = agent.inboxTasks.map((t, i) => `
    <li>
      <span class="num">${i + 1}.</span>
      <span>${escapeHtml(t.prettyName)}</span>
      <span class="file">${escapeHtml(t.filename)}</span>
    </li>
  `).join("");
  return `
    <div class="card">
      <h2>Inbox queue (${agent.inboxTasks.length})</h2>
      <ul class="inbox-list">${items}</ul>
    </div>
  `;
}

export function renderDetail(state: SupervisorState, agent: AgentState, dropped?: string | null): string {
  const resumeCmd = agent.sessionId
    ? `cd ${shellEscape(agent.home)} && claude --resume ${agent.sessionId}`
    : `cd ${shellEscape(agent.home)} && claude`;

  const flash = dropped
    ? `<div class="flash">✓ Dropped <code>${escapeHtml(dropped)}</code> into inbox.</div>`
    : "";

  const heartbeat = state.lastProbeAt && Date.now() - state.lastProbeAt < 60_000
    ? `<span class="heartbeat"><span style="width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent);"></span>probed ${relativeAge(state.lastProbeAt)}</span>`
    : `<span class="heartbeat" style="color:var(--bad)">supervisor stalled</span>`;

  const body = `
    <header class="bar">
      <h1><a href="/" style="color:inherit">meta-scheduler</a> <span class="crumb">/</span> ${escapeHtml(agent.name)}</h1>
      <div class="right">
        ${heartbeat}
        <a href="/api/state">JSON</a>
      </div>
    </header>
    <main class="narrow">
      ${flash}

      <div class="card">
        <h2>Status</h2>
        <dl class="kv">
          <dt>State</dt><dd>${statusBadge(agent.status)}</dd>
          <dt>Home</dt><dd><code>${escapeHtml(agent.home)}</code></dd>
          <dt>Identity</dt><dd>${agent.hasIdentity ? "<code>AGENTS.md</code> ✓" : '<span style="color:var(--bad)">missing AGENTS.md</span>'}</dd>
          <dt>Inbox / Doing / Done</dt><dd>${agent.inboxCount} / ${agent.doingCount} / ${agent.doneCount}</dd>
          <dt>Session</dt><dd>${agent.sessionId ? `<code>${escapeHtml(agent.sessionId)}</code>` : '<span style="color:var(--muted)">no session yet</span>'}</dd>
          <dt>Last activity</dt><dd>${relativeAge(agent.lastActivityMs)}</dd>
          <dt>tmux</dt><dd>${agent.runtime.tmuxSession ? `<code>${escapeHtml(agent.runtime.tmuxSession)}</code>${agent.runtime.pid ? ` <span style="color:var(--muted)">pid ${agent.runtime.pid}</span>` : ""}` : '<span style="color:var(--muted)">not running under supervisor</span>'}</dd>
          <dt>Restarts</dt><dd>${agent.runtime.restartCount}${agent.runtime.lastRestartAt ? ` <span style="color:var(--muted)">last ${relativeAge(agent.runtime.lastRestartAt)}</span>` : ""}${agent.runtime.circuitOpen ? ' <span style="color:var(--bad)">circuit open</span>' : ""}</dd>
        </dl>
      </div>

      ${currentTaskPanel(agent)}

      ${inboxPanel(agent)}

      <div class="card">
        <h2>Resume command</h2>
        <div class="copy-row">
          <code id="resume-cmd">${escapeHtml(resumeCmd)}</code>
          <button type="button" onclick="copyResume(this)">Copy</button>
        </div>
      </div>

      <div class="card">
        <h2>Drop a task into inbox</h2>
        <form method="post" action="/agent/${encodeURIComponent(agent.name)}/inbox">
          <div class="row">
            <label for="filename">Filename — saved as <code>inbox/&lt;NN&gt;-&lt;name&gt;.md</code></label>
            <input type="text" id="filename" name="filename" placeholder="e.g. clean-up-old-logs" required>
          </div>
          <div class="row">
            <label for="content">Markdown body</label>
            <textarea id="content" name="content" placeholder="# Task: ..." required></textarea>
          </div>
          <input type="submit" value="Drop into inbox">
        </form>
      </div>

      <div class="card">
        <h2>Live session log <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--muted-soft);font-size:11px;margin-left:4px;">SSE tail</span></h2>
        ${agent.sessionFile
          ? `<pre class="log" id="logbox">(connecting…)</pre>
            <script>
              (() => {
                const box = document.getElementById('logbox');
                box.textContent = '';
                const es = new EventSource('/agent/${encodeURIComponent(agent.name)}/tail');
                es.onmessage = (e) => {
                  const wasNearBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
                  box.textContent += e.data + '\\n';
                  if (wasNearBottom) box.scrollTop = box.scrollHeight;
                };
                es.onerror = () => { box.textContent += '\\n[stream disconnected]\\n'; };
              })();
            </script>`
          : `<div style="color:var(--muted);font-size:13.5px;">No session file yet. Boot the agent with the resume command above (or just <code>claude</code>) and refresh.</div>`}
      </div>
    </main>
    <script>
      function copyResume(btn) {
        const el = document.getElementById('resume-cmd');
        navigator.clipboard.writeText(el.textContent).then(() => {
          const old = btn.textContent;
          btn.textContent = 'Copied ✓';
          setTimeout(() => { btn.textContent = old; }, 1200);
        });
      }
    </script>
  `;
  return page(`${agent.name} — meta-scheduler`, body);
}
