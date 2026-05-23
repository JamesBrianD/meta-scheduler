export const STYLES = `
  :root { color-scheme: light dark; --fg: #1a1a1a; --bg: #fafafa; --muted: #6b7280; --border: #e5e7eb; --ok: #16a34a; --warn: #d97706; --bad: #dc2626; --idle: #6b7280; --accent: #2563eb; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e5e7eb; --bg: #0b0b0c; --muted: #9ca3af; --border: #232326; --ok: #4ade80; --warn: #fbbf24; --bad: #f87171; --idle: #9ca3af; --accent: #60a5fa; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  header { display: flex; align-items: baseline; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); }
  header h1 { font-size: 16px; font-weight: 600; margin: 0; }
  header .meta { color: var(--muted); font-size: 12px; }
  header a { color: var(--accent); text-decoration: none; margin-left: auto; }
  main { padding: 20px; max-width: 1100px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); }
  th { font-weight: 600; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  td.num { text-align: right; }
  a { color: var(--accent); }
  .status { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 500; border: 1px solid; }
  .status.healthy { color: var(--ok); border-color: var(--ok); }
  .status.suspicious { color: var(--warn); border-color: var(--warn); }
  .status.hang { color: var(--bad); border-color: var(--bad); }
  .status.no-session, .status.no-identity { color: var(--idle); border-color: var(--idle); }
  .panel { border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .panel h2 { font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 8px; }
  .kv { display: grid; grid-template-columns: 140px 1fr; gap: 4px 16px; font-size: 13px; }
  .kv dt { color: var(--muted); }
  .kv dd { margin: 0; word-break: break-all; }
  code { font: 12px/1.4 ui-monospace, "SF Mono", Menlo, monospace; background: rgba(127,127,127,0.12); padding: 1px 6px; border-radius: 4px; }
  pre.log { background: rgba(127,127,127,0.08); border: 1px solid var(--border); border-radius: 6px; padding: 12px; max-height: 50vh; overflow: auto; font: 12px/1.5 ui-monospace, "SF Mono", Menlo, monospace; }
  button, input[type=submit] { font: inherit; padding: 6px 12px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); border-radius: 6px; cursor: pointer; }
  button:hover { border-color: var(--accent); color: var(--accent); }
  textarea, input[type=text] { width: 100%; padding: 8px; font: 13px/1.5 ui-monospace, "SF Mono", Menlo, monospace; background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; }
  textarea { min-height: 140px; resize: vertical; }
  form .row { display: grid; gap: 6px; margin-bottom: 10px; }
  .copy-row { display: flex; gap: 8px; align-items: center; }
  .copy-row code { flex: 1; padding: 6px 10px; }
  .heartbeat-ok { color: var(--ok); }
  .heartbeat-bad { color: var(--bad); }
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
  if (age < 0) return "now";
  if (age < 60_000) return `${Math.floor(age / 1000)}s ago`;
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  return `${Math.floor(age / 86_400_000)}d ago`;
}

export function page(title: string, body: string, extraHead = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
${extraHead}
</head>
<body>
${body}
</body>
</html>`;
}
