import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function tmuxSessionName(agentName: string): string {
  return `agent-${agentName}`;
}

async function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("tmux", args, { encoding: "utf8" });
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}

export async function hasSession(name: string): Promise<boolean> {
  const r = await run(["has-session", "-t", `=${name}`]);
  return r.code === 0;
}

export async function panePid(name: string): Promise<number | null> {
  const r = await run(["list-panes", "-t", `=${name}`, "-F", "#{pane_pid}"]);
  if (r.code !== 0) return null;
  const line = r.stdout.split("\n")[0]?.trim();
  if (!line) return null;
  const pid = parseInt(line, 10);
  return Number.isFinite(pid) ? pid : null;
}

export async function killSession(name: string): Promise<boolean> {
  const r = await run(["kill-session", "-t", `=${name}`]);
  return r.code === 0;
}

export async function startSession(opts: { name: string; cwd: string; command: string }): Promise<boolean> {
  const r = await run([
    "new-session",
    "-d",
    "-s",
    opts.name,
    "-c",
    opts.cwd,
    opts.command,
  ]);
  return r.code === 0;
}
