import type { SupervisorState } from "../../supervisor/types.ts";
import type { Project, Session } from "../sessions.ts";
import { escapeHtml, relativeAge, renderSidebar, shell } from "./layout.ts";

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
}

function shellEscape(s: string): string {
  if (/^[A-Za-z0-9_./@:-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (Array.isArray(v)) {
    return v.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("");
  }
  return "";
}

function shortSummary(text: string, max = 220): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max) + "…";
}

function renderToolCall(b: ContentBlock): string {
  const name = b.name ?? "tool";
  const input = b.input ? JSON.stringify(b.input) : "";
  const summary = shortSummary(input, 280);
  return `<div class="tool-call">→ <span class="tool-name">${escapeHtml(name)}</span>${summary ? ` <span style="color:var(--muted-soft)">${escapeHtml(summary)}</span>` : ""}</div>`;
}

function renderToolResult(b: ContentBlock): string {
  const content = b.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) text = content.map((c: any) => c?.text ?? "").join("");
  if (!text.trim()) return "";
  const truncated = text.length > 800 ? text.slice(0, 800) + `\n… (${text.length - 800} more chars)` : text;
  return `<div class="tool-result">${escapeHtml(truncated)}</div>`;
}

function renderUserMessage(content: unknown): string {
  if (typeof content === "string") {
    if (isHiddenWrapper(content)) return "";
    return `<div class="body">${escapeHtml(content)}</div>`;
  }
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  let textBuf: string[] = [];
  for (const b of content as ContentBlock[]) {
    if (b?.type === "text") {
      const t = asString(b.text);
      if (t && !isHiddenWrapper(t)) textBuf.push(t);
    } else if (b?.type === "tool_result") {
      if (textBuf.length) {
        parts.push(`<div class="body">${escapeHtml(textBuf.join("\n"))}</div>`);
        textBuf = [];
      }
      const r = renderToolResult(b);
      if (r) parts.push(r);
    }
  }
  if (textBuf.length) parts.push(`<div class="body">${escapeHtml(textBuf.join("\n"))}</div>`);
  return parts.join("");
}

function renderAssistantMessage(content: unknown): string {
  if (typeof content === "string") {
    return `<div class="body">${escapeHtml(content)}</div>`;
  }
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  let textBuf: string[] = [];
  for (const b of content as ContentBlock[]) {
    if (b?.type === "text") {
      const t = asString(b.text);
      if (t) textBuf.push(t);
    } else if (b?.type === "tool_use") {
      if (textBuf.length) {
        parts.push(`<div class="body">${escapeHtml(textBuf.join("\n"))}</div>`);
        textBuf = [];
      }
      parts.push(renderToolCall(b));
    } else if (b?.type === "thinking") {
      // skip thinking blocks
    }
  }
  if (textBuf.length) parts.push(`<div class="body">${escapeHtml(textBuf.join("\n"))}</div>`);
  return parts.join("");
}

function isHiddenWrapper(text: string): boolean {
  const head = text.slice(0, 80);
  return (
    head.startsWith("<command-") ||
    head.startsWith("<local-command-") ||
    head.startsWith("<bash-stdout") ||
    head.startsWith("<bash-stderr") ||
    head.startsWith("Caveat:") ||
    head.startsWith("[Request interrupted") ||
    head.startsWith("<system-reminder>") ||
    text.startsWith("This session is being continued")
  );
}

function fmtTime(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export function renderSessionView(
  state: SupervisorState,
  projects: Project[],
  project: Project,
  session: Session,
  events: any[],
): string {
  const sidebar = renderSidebar({
    projects,
    activeProjectDir: project.dirName,
    activeSessionId: session.id,
    heartbeatOk: !!(state.lastProbeAt && Date.now() - state.lastProbeAt < 60_000),
    heartbeatLabel: state.lastProbeAt ? `supervisor · ${relativeAge(state.lastProbeAt)}` : "supervisor offline",
  });

  const cwd = session.cwd ?? project.cwd;
  const resumeCmd = `cd ${shellEscape(cwd)} && claude --resume ${session.id}`;

  const messages: string[] = [];
  let firstAssistant = true;
  for (const ev of events) {
    if (ev?.isSidechain) continue;
    const t = ev?.type;
    const ts = fmtTime(ev?.timestamp);
    if (t === "user") {
      const html = renderUserMessage(ev?.message?.content);
      if (html) {
        messages.push(`
          <div class="msg user">
            <div class="who">User <span class="ts">${escapeHtml(ts)}</span></div>
            ${html}
          </div>
        `);
      }
    } else if (t === "assistant") {
      const html = renderAssistantMessage(ev?.message?.content);
      if (html) {
        const model = ev?.message?.model ?? "";
        messages.push(`
          <div class="msg assistant">
            <div class="who">Assistant <span class="ts">${escapeHtml(ts)}${model ? ` · ${escapeHtml(model)}` : ""}</span></div>
            ${html}
          </div>
        `);
        firstAssistant = false;
      }
    }
  }

  const summary = `${session.title}`;

  const content = `
    <header class="bar">
      <h1>
        <a href="/" style="color:inherit">Home</a>
        <span class="crumb">/</span>
        <a href="/project/${encodeURIComponent(project.dirName)}" style="color:inherit">${escapeHtml(project.displayName)}</a>
        <span class="crumb">/</span>
        <span style="color:var(--fg-soft);font-weight:500">${escapeHtml(shortSummary(summary, 60))}</span>
      </h1>
      <div class="right">
        <span class="heartbeat" title="${escapeHtml(session.id)}">${escapeHtml(session.id.slice(0, 8))}…</span>
        <span class="heartbeat">${relativeAge(session.lastActivityMs)}${session.gitBranch ? ` · ${escapeHtml(session.gitBranch)}` : ""}</span>
      </div>
    </header>
    <main>
      <div class="card">
        <h2>Resume</h2>
        <div class="copy-row">
          <code id="resume-cmd">${escapeHtml(resumeCmd)}</code>
          <button type="button" onclick="copyResume(this)">Copy</button>
        </div>
      </div>
      <div class="conv">
        ${messages.length > 0 ? messages.join("") : '<div class="empty">No renderable messages.</div>'}
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

  return shell(`${session.title.slice(0, 40)} · ${project.displayName}`, sidebar, content);
}
