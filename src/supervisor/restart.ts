import { appendFile } from "node:fs/promises";
import type { AgentRuntime, AgentState, RestartRecord } from "./types.ts";
import { agentRestartLog, ensureAgentDir } from "./heartbeat.ts";
import { hasSession, killSession, panePid, startSession, tmuxSessionName } from "./tmux.ts";

const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const CIRCUIT_WINDOW_MS = 10 * 60_000;
const CIRCUIT_THRESHOLD = 5;
const KILL_GRACE_MS = 8_000;

export function emptyRuntime(): AgentRuntime {
  return {
    tmuxSession: null,
    pid: null,
    restartCount: 0,
    lastRestartAt: null,
    recentRestarts: [],
    circuitOpen: false,
    circuitOpenedAt: null,
  };
}

export async function refreshRuntime(agentName: string, prev: AgentRuntime): Promise<AgentRuntime> {
  const session = tmuxSessionName(agentName);
  const exists = await hasSession(session);
  const pid = exists ? await panePid(session) : null;
  return {
    ...prev,
    tmuxSession: exists ? session : null,
    pid,
  };
}

function backoffMs(restartCount: number): number {
  return BACKOFF_MS[Math.min(restartCount, BACKOFF_MS.length - 1)];
}

function pruneRecent(times: number[], now: number): number[] {
  return times.filter((t) => now - t < CIRCUIT_WINDOW_MS);
}

export interface RestartDecision {
  action: "skip" | "wait-backoff" | "wait-circuit" | "wait-network" | "no-session" | "go";
  reason: string;
  waitMs?: number;
}

export function shouldRestart(
  agent: AgentState,
  apiGate: boolean,
  now: number,
): RestartDecision {
  if (agent.status !== "hang") {
    return { action: "skip", reason: `status=${agent.status}` };
  }
  if (!apiGate) {
    return { action: "wait-network", reason: "api gate not open (need 60s consecutive ok)" };
  }
  if (!agent.sessionId) {
    return { action: "no-session", reason: "no session id to resume" };
  }
  const r = agent.runtime;
  if (r.circuitOpen) {
    return { action: "wait-circuit", reason: "circuit open: 5 restarts in 10m" };
  }
  if (r.lastRestartAt) {
    const waitMs = backoffMs(r.restartCount) - (now - r.lastRestartAt);
    if (waitMs > 0) return { action: "wait-backoff", reason: "backoff", waitMs };
  }
  return { action: "go", reason: "hang detected, gates clear" };
}

async function logRestart(agentName: string, rec: RestartRecord): Promise<void> {
  await ensureAgentDir(agentName);
  const line = `${new Date(rec.at).toISOString()} ok=${rec.ok} reason=${JSON.stringify(rec.reason)}${
    rec.detail ? ` detail=${JSON.stringify(rec.detail)}` : ""
  }\n`;
  await appendFile(agentRestartLog(agentName), line, "utf8");
}

async function waitProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export async function performRestart(agent: AgentState): Promise<{
  ok: boolean;
  detail: string;
  runtime: AgentRuntime;
}> {
  const agentName = agent.name;
  const session = tmuxSessionName(agentName);
  const sessionId = agent.sessionId;
  if (!sessionId) {
    return {
      ok: false,
      detail: "no session id",
      runtime: { ...agent.runtime },
    };
  }
  const prevPid = agent.runtime.pid;

  if (await hasSession(session)) {
    await killSession(session);
    if (prevPid) {
      const exited = await waitProcessExit(prevPid, KILL_GRACE_MS);
      if (!exited) {
        try {
          process.kill(prevPid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  }

  const cmd = `claude --resume ${JSON.stringify(sessionId)}`;
  const ok = await startSession({ name: session, cwd: agent.home, command: cmd });
  const now = Date.now();
  const prev = agent.runtime;
  const recent = pruneRecent([...prev.recentRestarts, now], now);
  const circuitOpen = recent.length >= CIRCUIT_THRESHOLD;

  const runtime: AgentRuntime = {
    tmuxSession: ok ? session : prev.tmuxSession,
    pid: prev.pid,
    restartCount: prev.restartCount + 1,
    lastRestartAt: now,
    recentRestarts: recent,
    circuitOpen,
    circuitOpenedAt: circuitOpen && !prev.circuitOpen ? now : prev.circuitOpenedAt,
  };

  await logRestart(agentName, {
    at: now,
    reason: "hang detected",
    ok,
    detail: ok ? `started tmux session ${session}` : `failed to start session ${session}`,
  });

  return { ok, detail: ok ? "restarted" : "tmux start failed", runtime };
}
