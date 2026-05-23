import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentState, AgentStatus, TaskFile } from "./types.ts";

const SUSPICIOUS_AGE_MS = 120_000;
const HANG_AGE_MS = 3_000_000;

function encodeCwd(absPath: string): string {
  return absPath.replace(/\//g, "-");
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function listMd(dir: string): Promise<TaskFile[]> {
  try {
    const entries = await readdir(dir);
    return entries
      .filter((f) => f.endsWith(".md") && !f.startsWith("."))
      .sort()
      .map((filename) => ({ filename, prettyName: prettifyTaskName(filename) }));
  } catch {
    return [];
  }
}

function prettifyTaskName(filename: string): string {
  let stem = filename.replace(/\.md$/, "");
  stem = stem.replace(/^\d+[-_]/, "");
  return stem.replace(/[-_]/g, " ");
}

async function findLiveSession(agentHome: string): Promise<{ id: string; file: string; mtimeMs: number } | null> {
  const projectsDir = join(homedir(), ".claude", "projects", encodeCwd(agentHome));
  let entries: string[];
  try {
    entries = await readdir(projectsDir);
  } catch {
    return null;
  }
  const jsonl = entries.filter((f) => f.endsWith(".jsonl"));
  if (jsonl.length === 0) return null;

  let best: { id: string; file: string; mtimeMs: number } | null = null;
  for (const f of jsonl) {
    const full = join(projectsDir, f);
    try {
      const s = await stat(full);
      if (!best || s.mtimeMs > best.mtimeMs) {
        best = { id: f.replace(/\.jsonl$/, ""), file: full, mtimeMs: s.mtimeMs };
      }
    } catch {
      // ignore unreadable
    }
  }
  return best;
}

function classify(hasIdentity: boolean, sessionFound: boolean, lastActivityMs: number | null, now: number): AgentStatus {
  if (!hasIdentity) return "no-identity";
  if (!sessionFound || lastActivityMs == null) return "no-session";
  const age = now - lastActivityMs;
  if (age > HANG_AGE_MS) return "hang";
  if (age > SUSPICIOUS_AGE_MS) return "suspicious";
  return "healthy";
}

export async function readVault(vaultDir: string): Promise<AgentState[]> {
  const root = resolve(vaultDir);
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }

  const out: AgentState[] = [];
  const now = Date.now();
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const home = join(root, name);
    if (!(await isDir(home))) continue;

    const hasIdentity = await isFile(join(home, "AGENTS.md"));
    const [inboxTasks, doingTasks, doneTasks] = await Promise.all([
      listMd(join(home, "inbox")),
      listMd(join(home, "doing")),
      listMd(join(home, "done")),
    ]);

    const session = await findLiveSession(home);
    const lastActivityMs = session?.mtimeMs ?? null;

    out.push({
      name,
      home,
      hasIdentity,
      inboxCount: inboxTasks.length,
      doingCount: doingTasks.length,
      doneCount: doneTasks.length,
      doingTasks,
      inboxTasks,
      sessionId: session?.id ?? null,
      sessionFile: session?.file ?? null,
      lastActivityMs,
      status: classify(hasIdentity, !!session, lastActivityMs, now),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
