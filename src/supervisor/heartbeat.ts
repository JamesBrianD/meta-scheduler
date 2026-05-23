import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const STATE_DIR = join(homedir(), ".meta-scheduler");
export const HEARTBEAT_FILE = join(STATE_DIR, "supervisor.heartbeat");

export async function ensureStateDir(): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
}

export async function writeHeartbeat(state: { pid: number; probedAt: number }): Promise<void> {
  await writeFile(HEARTBEAT_FILE, `${state.pid} ${state.probedAt}\n`, "utf8");
}

export function agentRestartLog(agentName: string): string {
  return join(STATE_DIR, agentName, "restart.log");
}

export async function ensureAgentDir(agentName: string): Promise<string> {
  const dir = join(STATE_DIR, agentName);
  await mkdir(dir, { recursive: true });
  return dir;
}
