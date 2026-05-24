import type { Project } from "../sessions.ts";
import { groupProjects } from "../sessions.ts";

export const STYLES = `
  :root {
    --fg: #0f172a;
    --fg-soft: #334155;
    --muted: #64748b;
    --muted-soft: #94a3b8;
    --bg: #f6f7f9;
    --surface: #ffffff;
    --sidebar-bg: #fafbfc;
    --border: #e6e8ec;
    --border-soft: #eef0f3;
    --hover: #f1f5f9;
    --accent: #4f46e5;
    --accent-bg: #eef2ff;
    --ok: #16a34a;
    --ok-bg: #ecfdf5;
    --warn: #d97706;
    --warn-bg: #fffbeb;
    --bad: #dc2626;
    --bad-bg: #fef2f2;
    --idle: #64748b;
    --idle-bg: #f1f5f9;
    --shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06);
    --radius: 10px;
    --radius-sm: 6px;
    --sidebar-width: 280px;
  }

  * { box-sizing: border-box; }
  html, body { background: var(--bg); height: 100%; }
  body {
    margin: 0;
    color: var(--fg);
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  .shell {
    display: grid;
    grid-template-columns: var(--sidebar-width) 1fr;
    min-height: 100vh;
  }
  .content-pane { min-width: 0; overflow-x: hidden; }

  .sidebar {
    background: var(--sidebar-bg);
    border-right: 1px solid var(--border);
    overflow-y: auto;
    height: 100vh;
    position: sticky;
    top: 0;
    display: flex;
    flex-direction: column;
  }
  .sidebar .brand {
    padding: 16px 18px 12px;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--fg);
    border-bottom: 1px solid var(--border-soft);
  }
  .sidebar .brand a {
    color: inherit; text-decoration: none;
    display: flex; align-items: center; gap: 8px;
  }
  .sidebar .brand .logo {
    width: 18px; height: 18px;
    border-radius: 4px;
    background: linear-gradient(135deg, var(--accent), #7c3aed);
    display: inline-block;
  }
  .sidebar-section-title {
    padding: 14px 18px 6px;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .sidebar-project { margin-bottom: 1px; }
  .sidebar-project .project-head {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 18px;
    color: var(--fg-soft);
    font-weight: 500;
    cursor: pointer;
    user-select: none;
    font-size: 13px;
    text-decoration: none;
  }
  .sidebar-project .project-head:hover { background: var(--hover); text-decoration: none; }
  .sidebar-project.active .project-head { color: var(--fg); }
  .sidebar-project .caret {
    width: 0; height: 0;
    border-left: 4px solid var(--muted-soft);
    border-top: 3px solid transparent;
    border-bottom: 3px solid transparent;
    margin-right: 2px;
    transition: transform 0.1s ease;
    flex-shrink: 0;
  }
  .sidebar-project.open .caret { transform: rotate(90deg); }
  .sidebar-project .project-name {
    flex: 1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .sidebar-project .project-count {
    color: var(--muted-soft);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }
  .sidebar-sessions {
    list-style: none;
    margin: 0; padding: 0;
    display: none;
  }
  .sidebar-project.open .sidebar-sessions { display: block; }
  .sidebar-project.worktree .project-head { padding-left: 36px; font-size: 12.5px; color: var(--muted); }
  .sidebar-project.worktree .caret { border-left-color: var(--muted-soft); }
  .sidebar-project.worktree.active .project-head { color: var(--fg-soft); }
  .sidebar-project .wt-badge {
    font-size: 9.5px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted);
    background: var(--idle-bg);
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .sidebar-sessions li a {
    display: flex; align-items: baseline; gap: 8px;
    padding: 5px 18px 5px 36px;
    color: var(--fg-soft);
    font-size: 12.5px;
    line-height: 1.45;
    text-decoration: none;
  }
  .sidebar-sessions li a:hover {
    background: var(--hover);
    color: var(--fg);
  }
  .sidebar-sessions li.active a {
    background: var(--accent-bg);
    color: var(--accent);
    font-weight: 500;
  }
  .sidebar-sessions .session-title {
    flex: 1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .sidebar-sessions .session-age {
    color: var(--muted-soft);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .sidebar-toggle {
    margin-top: auto;
    padding: 8px 14px 4px;
  }
  .sidebar-toggle .link-btn {
    background: transparent;
    border: 1px solid var(--border-soft);
    padding: 5px 10px;
    width: 100%;
    border-radius: var(--radius-sm);
    color: var(--muted);
    font-size: 11.5px;
    text-align: left;
    cursor: pointer;
  }
  .sidebar-toggle .link-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-bg);
  }
  .sidebar-footer {
    padding: 12px 18px;
    border-top: 1px solid var(--border-soft);
    display: flex; align-items: center; gap: 10px;
    font-size: 11.5px;
    color: var(--muted);
  }
  .sidebar-footer .heartbeat-dot { width: 7px; height: 7px; border-radius: 50%; }
  .sidebar-footer.ok .heartbeat-dot { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent); }
  .sidebar-footer.bad .heartbeat-dot { background: var(--bad); }

  main {
    padding: 24px 32px 64px;
    max-width: 1180px;
    overflow-x: hidden;
  }
  main.narrow { max-width: 880px; }
  main.wide { max-width: 100%; }

  header.bar {
    display: flex; align-items: center; gap: 16px;
    padding: 14px 32px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 5;
  }
  header.bar h1 {
    margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -0.01em;
  }
  header.bar h1 .crumb { color: var(--muted); font-weight: 500; margin: 0 6px; }
  header.bar .meta {
    color: var(--muted); font-size: 12.5px; display: flex; align-items: center; gap: 6px;
  }
  header.bar .meta code { background: var(--idle-bg); }
  header.bar .right { margin-left: auto; display: flex; gap: 14px; align-items: center; }
  header.bar .heartbeat { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12.5px; }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 20px 22px;
    margin-bottom: 18px;
  }
  .card > h2 {
    margin: 0 0 14px;
    font-size: 11.5px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--muted);
  }

  .agent-grid { display: grid; gap: 12px; }
  .agent-row {
    display: grid;
    grid-template-columns: minmax(180px, 1.2fr) auto minmax(220px, 2fr) auto auto;
    gap: 18px;
    align-items: center;
    padding: 14px 18px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    transition: border-color 0.15s ease;
  }
  .agent-row:hover { border-color: #d6d9df; }
  .agent-row .name { font-weight: 600; font-size: 14.5px; color: var(--fg); }
  .agent-row .name a { color: inherit; }
  .agent-row .name a:hover { color: var(--accent); text-decoration: none; }
  .agent-row .current {
    color: var(--fg-soft); font-size: 13px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .agent-row .current.empty { color: var(--muted-soft); font-style: italic; }
  .agent-row .counts {
    display: flex; gap: 14px; font-variant-numeric: tabular-nums;
    color: var(--muted); font-size: 12.5px;
  }
  .agent-row .counts span b { color: var(--fg); font-weight: 600; }
  .agent-row .age { color: var(--muted); font-size: 12.5px; min-width: 70px; text-align: right; }

  .status {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 10px 3px 8px;
    border-radius: 999px;
    font-size: 12px; font-weight: 500;
    line-height: 1.2;
  }
  .status .dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 18%, transparent);
  }
  .status.healthy { color: var(--ok); background: var(--ok-bg); }
  .status.suspicious { color: var(--warn); background: var(--warn-bg); }
  .status.hang { color: var(--bad); background: var(--bad-bg); }
  .status.no-session, .status.no-identity { color: var(--idle); background: var(--idle-bg); }

  dl.kv { display: grid; grid-template-columns: 160px 1fr; gap: 8px 20px; margin: 0; font-size: 13.5px; }
  dl.kv dt { color: var(--muted); font-weight: 500; }
  dl.kv dd { margin: 0; color: var(--fg); word-break: break-word; }

  code, pre { font: 12.5px/1.5 ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace; }
  code {
    background: var(--idle-bg);
    padding: 1px 6px;
    border-radius: 4px;
    color: var(--fg-soft);
  }
  pre.log {
    background: #0f172a;
    color: #e2e8f0;
    border-radius: var(--radius-sm);
    padding: 14px 16px;
    margin: 0;
    max-height: 56vh;
    overflow: auto;
    font-size: 11.5px; line-height: 1.5;
    border: 1px solid #1e293b;
  }
  pre.log::-webkit-scrollbar { width: 10px; height: 10px; }
  pre.log::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 6px; }

  button, input[type=submit] {
    font: inherit;
    padding: 7px 14px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--fg);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.12s ease;
    font-weight: 500;
  }
  button:hover, input[type=submit]:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-bg);
  }
  input[type=submit] {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  input[type=submit]:hover {
    background: #4338ca;
    border-color: #4338ca;
    color: white;
  }
  textarea, input[type=text] {
    width: 100%;
    padding: 9px 12px;
    font: 13px/1.5 ui-monospace, "SF Mono", Menlo, monospace;
    background: var(--surface);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  textarea { min-height: 160px; resize: vertical; }
  textarea:focus, input[type=text]:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-bg);
  }
  form .row { display: grid; gap: 6px; margin-bottom: 12px; }
  form label { font-size: 12.5px; color: var(--muted); font-weight: 500; }

  .copy-row {
    display: flex; gap: 10px; align-items: stretch;
    background: var(--idle-bg);
    padding: 8px 8px 8px 14px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-soft);
  }
  .copy-row code {
    flex: 1;
    background: transparent;
    padding: 6px 0;
    color: var(--fg);
    word-break: break-all;
  }
  .copy-row button { background: var(--surface); flex-shrink: 0; }

  .task-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .task-list li {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px;
    background: var(--accent-bg);
    border: 1px solid #dbe2ff;
    border-radius: var(--radius-sm);
  }
  .task-list li .pulse {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
    animation: pulse 1.6s ease-in-out infinite;
    flex-shrink: 0;
  }
  .task-list li .label { font-weight: 500; color: var(--fg); }
  .task-list li .file { color: var(--muted); font-size: 12px; margin-left: auto; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.45; }
  }

  .restart-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .restart-list li {
    display: grid;
    grid-template-columns: 200px 60px 1fr;
    gap: 10px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-soft);
    align-items: baseline;
  }
  .restart-list li:last-child { border-bottom: 0; }
  .restart-list li .restart-when { color: var(--muted); font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11.5px; }
  .restart-list li .restart-status { font-weight: 600; }
  .restart-list li .restart-reason { color: var(--fg-soft); }
  .restart-list li .restart-detail { grid-column: 3; color: var(--muted); font-size: 11.5px; }

  .inbox-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .inbox-list li {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px;
    color: var(--fg-soft);
    border-radius: var(--radius-sm);
    font-size: 13px;
  }
  .inbox-list li .num { color: var(--muted-soft); font-variant-numeric: tabular-nums; min-width: 22px; }
  .inbox-list li .file { color: var(--muted); font-size: 12px; margin-left: auto; font-family: ui-monospace, "SF Mono", Menlo, monospace; }

  .empty {
    color: var(--muted);
    padding: 36px 20px;
    text-align: center;
    background: var(--surface);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
  }

  .flash {
    background: var(--ok-bg); color: var(--ok);
    padding: 10px 14px;
    border: 1px solid color-mix(in srgb, var(--ok) 20%, transparent);
    border-radius: var(--radius-sm);
    margin-bottom: 16px;
    font-size: 13px;
  }

  /* Conversation viewer */
  .tail-banner {
    background: var(--accent-bg);
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
    border-radius: var(--radius-sm);
    padding: 8px 14px;
    margin-bottom: 14px;
    font-size: 12.5px;
    text-align: center;
  }
  .tail-banner a { font-weight: 500; }
  .conv { display: grid; gap: 14px; }
  .session-meta {
    display: grid; grid-template-columns: 1fr; gap: 10px;
    margin-bottom: 4px;
  }
  .msg {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 18px;
    box-shadow: var(--shadow);
  }
  .msg.user { border-left: 3px solid var(--accent); }
  .msg.assistant { border-left: 3px solid var(--ok); }
  .msg.system { border-left: 3px solid var(--muted-soft); background: var(--sidebar-bg); }
  .msg .who {
    font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--muted);
    margin-bottom: 8px;
    display: flex; align-items: center; gap: 8px;
  }
  .msg .who .ts { font-weight: 400; color: var(--muted-soft); text-transform: none; letter-spacing: 0; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .msg .body {
    font-size: 13.5px; line-height: 1.6;
    color: var(--fg);
    white-space: pre-wrap; word-wrap: break-word;
  }
  .msg .body pre {
    background: var(--idle-bg);
    padding: 10px 12px;
    overflow-x: auto;
    font-size: 12px;
    margin: 8px 0;
    white-space: pre;
    border-radius: 4px;
  }
  .msg .tool-call {
    font-size: 12px;
    color: var(--muted);
    background: var(--idle-bg);
    padding: 6px 10px;
    border-radius: 4px;
    margin: 6px 0;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    border: 1px solid var(--border-soft);
  }
  .msg .tool-call .tool-name { color: var(--accent); font-weight: 500; }
  .msg .tool-result {
    font-size: 11.5px;
    color: var(--fg-soft);
    background: var(--idle-bg);
    padding: 8px 10px;
    border-radius: 4px;
    margin: 4px 0;
    max-height: 200px;
    overflow: auto;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    white-space: pre-wrap;
  }

  .session-list { display: grid; gap: 8px; }
  .session-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 18px;
    box-shadow: var(--shadow);
    transition: border-color 0.15s ease;
  }
  .session-card:hover { border-color: #d6d9df; }
  .session-card a { display: flex; align-items: baseline; gap: 12px; color: inherit; text-decoration: none; }
  .session-card .session-card-title {
    flex: 1; color: var(--fg); font-weight: 500;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .session-card .session-card-meta {
    color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
`;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function relativeAge(ms: number | null): string {
  if (ms == null) return "—";
  const age = Date.now() - ms;
  if (age < 0) return "just now";
  if (age < 10_000) return "just now";
  if (age < 60_000) return `${Math.floor(age / 1000)}s`;
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h`;
  if (age < 7 * 86_400_000) return `${Math.floor(age / 86_400_000)}d`;
  return `${Math.floor(age / (7 * 86_400_000))}w`;
}

export function statusBadge(status: string): string {
  return `<span class="status ${escapeHtml(status)}"><span class="dot"></span>${escapeHtml(status)}</span>`;
}

export interface SidebarOpts {
  projects: Project[];
  activeProjectDir?: string;
  activeSessionId?: string;
  heartbeatOk: boolean;
  heartbeatLabel: string;
  showOld?: boolean;
  currentPath?: string;
}

export function renderSidebar(opts: SidebarOpts): string {
  const renderOne = (p: Project, isWorktree: boolean): string => {
    const isActive = p.dirName === opts.activeProjectDir;
    const isOpen = isActive;
    const sessions = isOpen
      ? `<ul class="sidebar-sessions">${p.sessions.slice(0, 30).map((s) => {
          const cls = s.id === opts.activeSessionId ? ' class="active"' : "";
          return `<li${cls}><a href="/session/${encodeURIComponent(p.dirName)}/${encodeURIComponent(s.id)}" title="${escapeHtml(s.title)}"><span class="session-title">${escapeHtml(s.title)}</span><span class="session-age">${relativeAge(s.lastActivityMs)}</span></a></li>`;
        }).join("")}</ul>`
      : "";
    const wtBadge = isWorktree && p.worktreeLabel
      ? `<span class="wt-badge" title="${escapeHtml(p.worktreeLabel)}">wt</span>`
      : "";
    return `
      <div class="sidebar-project${isActive ? " active" : ""}${isOpen ? " open" : ""}${isWorktree ? " worktree" : ""}">
        <a class="project-head" href="/project/${encodeURIComponent(p.dirName)}">
          <span class="caret"></span>
          <span class="project-name" title="${escapeHtml(p.cwd)}">${escapeHtml(p.displayName)}</span>
          ${wtBadge}
          <span class="project-count">${p.sessionCount}</span>
        </a>
        ${sessions}
      </div>
    `;
  };

  const groups = groupProjects(opts.projects);
  const projectItems = groups.map((g) => {
    const head = renderOne(g.primary, !!g.primary.worktreeOf);
    const wts = g.worktrees.map((w) => renderOne(w, true)).join("");
    return head + wts;
  }).join("");

  return `
    <aside class="sidebar">
      <div class="brand">
        <a href="/"><span class="logo"></span>meta-scheduler</a>
      </div>
      <div class="sidebar-section-title">Projects</div>
      ${projectItems || '<div style="padding:20px 18px;color:var(--muted);font-size:12.5px;">No projects found in <code>~/.claude/projects/</code>.</div>'}
      <form method="post" action="/toggle-old?back=${encodeURIComponent(opts.currentPath ?? "/")}" class="sidebar-toggle">
        <button type="submit" class="link-btn">${opts.showOld ? "Hide sessions > 7d" : "Show all sessions"}</button>
      </form>
      <div class="sidebar-footer ${opts.heartbeatOk ? "ok" : "bad"}">
        <span class="heartbeat-dot"></span>
        <span>${escapeHtml(opts.heartbeatLabel)}</span>
      </div>
    </aside>
  `;
}

export function shell(title: string, sidebar: string, content: string, extraHead = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
${extraHead}
</head>
<body>
<div class="shell">
${sidebar}
<div class="content-pane">${content}</div>
</div>
</body>
</html>`;
}

export function page(title: string, body: string, extraHead = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
${extraHead}
</head>
<body>
${body}
</body>
</html>`;
}
