import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

export class InboxError extends Error {
  constructor(message: string, public status: number = 400) {
    super(message);
  }
}

function sanitizeStem(filename: string): string {
  let stem = filename.trim();
  if (stem.endsWith(".md")) stem = stem.slice(0, -3);
  stem = stem.replace(/^\d+-/, "");
  if (!SAFE_NAME.test(stem)) {
    throw new InboxError(`Invalid filename "${filename}": only [a-zA-Z0-9._-] allowed, must not start with a separator.`);
  }
  if (stem.length > 80) {
    throw new InboxError(`Filename too long (max 80 chars after the NN- prefix).`);
  }
  return stem;
}

async function nextPrefix(inboxDir: string): Promise<string> {
  let entries: string[] = [];
  try {
    entries = await readdir(inboxDir);
  } catch {
    return "01";
  }
  let max = 0;
  for (const e of entries) {
    const m = /^(\d+)-/.exec(e);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  const next = max + 1;
  return next.toString().padStart(2, "0");
}

export async function dropTask(agentHome: string, filename: string, content: string): Promise<{ path: string }> {
  if (!content || content.trim().length === 0) {
    throw new InboxError("Empty task content.");
  }
  const stem = sanitizeStem(filename);
  const inboxDir = join(agentHome, "inbox");
  await mkdir(inboxDir, { recursive: true });
  const prefix = await nextPrefix(inboxDir);
  const path = join(inboxDir, `${prefix}-${stem}.md`);
  await writeFile(path, content.endsWith("\n") ? content : content + "\n", { flag: "wx" });
  return { path };
}
