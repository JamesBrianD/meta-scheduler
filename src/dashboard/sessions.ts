import { readdir, stat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, basename } from "node:path";

export interface Session {
  id: string;
  projectDir: string;
  title: string;
  lastActivityMs: number;
  sizeBytes: number;
  cwd: string | null;
  gitBranch: string | null;
}

export interface Project {
  dirName: string;
  cwd: string;
  displayName: string;
  lastActivityMs: number;
  sessionCount: number;
  sessions: Session[];
}

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const PREVIEW_LINES_TO_SCAN = 200;
const TITLE_MAX = 80;

function isCommandLike(content: string): boolean {
  const head = content.slice(0, 80);
  return (
    head.startsWith("<command-") ||
    head.startsWith("<local-command-") ||
    head.startsWith("<bash-stdout") ||
    head.startsWith("<bash-stderr") ||
    head.startsWith("Caveat:") ||
    head.startsWith("[Request interrupted") ||
    head.startsWith("<system-reminder>") ||
    /^This session is being continued/.test(head)
  );
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (c && typeof c === "object" && typeof c.text === "string" ? c.text : ""))
      .join(" ")
      .trim();
  }
  return "";
}

async function readSessionMeta(filePath: string, sizeBytes: number, mtimeMs: number): Promise<Omit<Session, "id" | "projectDir"> | null> {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(Math.min(sizeBytes, 256 * 1024));
    await fh.read(buf, 0, buf.length, 0);
    const text = buf.toString("utf8");
    const lines = text.split("\n").slice(0, PREVIEW_LINES_TO_SCAN);
    let title: string | null = null;
    let cwd: string | null = null;
    let gitBranch: string | null = null;
    for (const line of lines) {
      if (!line) continue;
      let d: any;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      if (cwd == null && typeof d.cwd === "string") cwd = d.cwd;
      if (gitBranch == null && typeof d.gitBranch === "string") gitBranch = d.gitBranch;
      if (title == null && d.type === "user" && d.message && typeof d.message === "object") {
        const text = extractTextContent(d.message.content);
        if (text && !isCommandLike(text)) {
          title = text.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
        }
      }
      if (title && cwd && gitBranch) break;
    }
    return {
      title: title ?? "(no prompt yet)",
      lastActivityMs: mtimeMs,
      sizeBytes,
      cwd,
      gitBranch,
    };
  } finally {
    await fh.close();
  }
}

async function scanProjectDir(dirName: string): Promise<Project | null> {
  const dirPath = join(PROJECTS_DIR, dirName);
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return null;
  }
  const jsonls = entries.filter((e) => e.endsWith(".jsonl"));
  if (jsonls.length === 0) return null;

  const sessions: Session[] = (
    await Promise.all(
      jsonls.map(async (file) => {
        const filePath = join(dirPath, file);
        try {
          const st = await stat(filePath);
          if (!st.isFile() || st.size === 0) return null;
          const meta = await readSessionMeta(filePath, st.size, st.mtimeMs);
          if (!meta) return null;
          const id = file.replace(/\.jsonl$/, "");
          return { id, projectDir: dirName, ...meta } satisfies Session;
        } catch {
          return null;
        }
      }),
    )
  ).filter((s): s is Session => s !== null);
  if (sessions.length === 0) return null;

  sessions.sort((a, b) => b.lastActivityMs - a.lastActivityMs);

  const cwd = sessions.find((s) => s.cwd)?.cwd ?? guessCwdFromDirName(dirName);
  const displayName = basename(cwd);
  const lastActivityMs = sessions[0].lastActivityMs;

  return {
    dirName,
    cwd,
    displayName,
    lastActivityMs,
    sessionCount: sessions.length,
    sessions,
  };
}

function guessCwdFromDirName(dirName: string): string {
  return dirName.replace(/-/g, "/");
}

let cache: { at: number; projects: Project[] } | null = null;
const CACHE_TTL_MS = 30_000;

export async function listProjects(force = false): Promise<Project[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.projects;
  }
  let entries: string[];
  try {
    entries = await readdir(PROJECTS_DIR);
  } catch {
    return [];
  }
  const filtered = entries.filter((n) => !n.startsWith("."));
  const results = await Promise.all(filtered.map((name) => scanProjectDir(name).catch(() => null)));
  const projects = results.filter((p): p is Project => p !== null);
  projects.sort((a, b) => b.lastActivityMs - a.lastActivityMs);
  cache = { at: Date.now(), projects };
  return projects;
}

export async function readSessionEvents(projectDir: string, sessionId: string, max = 5000): Promise<any[]> {
  const filePath = join(PROJECTS_DIR, projectDir, `${sessionId}.jsonl`);
  const fh = await open(filePath, "r");
  try {
    const st = await fh.stat();
    const buf = Buffer.alloc(st.size);
    await fh.read(buf, 0, st.size, 0);
    const lines = buf.toString("utf8").split("\n");
    const out: any[] = [];
    for (const line of lines) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // skip malformed
      }
      if (out.length >= max) break;
    }
    return out;
  } finally {
    await fh.close();
  }
}

export function findProject(projects: Project[], dirName: string): Project | undefined {
  return projects.find((p) => p.dirName === dirName);
}

export function findSession(project: Project, sessionId: string): Session | undefined {
  return project.sessions.find((s) => s.id === sessionId);
}
