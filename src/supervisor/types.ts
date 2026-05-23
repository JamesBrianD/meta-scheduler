export type AgentStatus = "healthy" | "suspicious" | "hang" | "no-session" | "no-identity";

export interface TaskFile {
  filename: string;
  prettyName: string;
}

export interface RestartRecord {
  at: number;
  reason: string;
  ok: boolean;
  detail?: string;
}

export interface AgentRuntime {
  tmuxSession: string | null;
  pid: number | null;
  restartCount: number;
  lastRestartAt: number | null;
  recentRestarts: number[];
  circuitOpen: boolean;
  circuitOpenedAt: number | null;
}

export interface AgentState {
  name: string;
  home: string;
  hasIdentity: boolean;
  inboxCount: number;
  doingCount: number;
  doneCount: number;
  doingTasks: TaskFile[];
  inboxTasks: TaskFile[];
  sessionId: string | null;
  sessionFile: string | null;
  lastActivityMs: number | null;
  status: AgentStatus;
  runtime: AgentRuntime;
}

export type ApiProbeStatus = "ok" | "down" | "unknown";

export interface ApiProbeState {
  status: ApiProbeStatus;
  lastOkAt: number | null;
  lastFailAt: number | null;
  consecutiveOkMs: number;
  detail: string | null;
}

export interface SupervisorState {
  startedAt: number;
  lastProbeAt: number | null;
  vaultDir: string;
  agents: AgentState[];
  apiProbe: ApiProbeState;
  restartEnabled: boolean;
}
