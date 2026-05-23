export type AgentStatus = "healthy" | "suspicious" | "hang" | "no-session" | "no-identity";

export interface AgentState {
  name: string;
  home: string;
  hasIdentity: boolean;
  inboxCount: number;
  doingCount: number;
  doneCount: number;
  sessionId: string | null;
  sessionFile: string | null;
  lastActivityMs: number | null;
  status: AgentStatus;
}

export interface SupervisorState {
  startedAt: number;
  lastProbeAt: number | null;
  vaultDir: string;
  agents: AgentState[];
}
