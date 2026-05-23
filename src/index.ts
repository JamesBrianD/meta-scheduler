import { resolve } from "node:path";
import { startServer } from "./dashboard/server.ts";
import { readVault } from "./supervisor/vault.ts";
import { initialApiProbeState, apiGateOpen, probeApi } from "./supervisor/api-probe.ts";
import { ensureStateDir, writeHeartbeat } from "./supervisor/heartbeat.ts";
import { performRestart, shouldRestart } from "./supervisor/restart.ts";
import type { AgentRuntime, SupervisorState } from "./supervisor/types.ts";

const VAULT_DIR = process.env.VAULT_DIR
  ? resolve(process.env.VAULT_DIR)
  : resolve(process.cwd(), "private/agents");
const HOST = process.env.BIND_HOST ?? "127.0.0.1";
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 7421;
const PROBE_INTERVAL_MS = 5_000;
const API_PROBE_INTERVAL_MS = 30_000;
const RESTART_ENABLED = process.env.RESTART_ENABLED === "true";

const state: SupervisorState = {
  startedAt: Date.now(),
  lastProbeAt: null,
  vaultDir: VAULT_DIR,
  agents: [],
  apiProbe: initialApiProbeState(),
  restartEnabled: RESTART_ENABLED,
};

const runtimeMap = new Map<string, AgentRuntime>();
let lastApiProbeAt = 0;

await ensureStateDir();

async function probe() {
  try {
    const now = Date.now();
    if (now - lastApiProbeAt >= API_PROBE_INTERVAL_MS) {
      state.apiProbe = await probeApi(state.apiProbe, now);
      lastApiProbeAt = now;
    }

    state.agents = await readVault(VAULT_DIR, runtimeMap);
    for (const a of state.agents) runtimeMap.set(a.name, a.runtime);
    state.lastProbeAt = Date.now();

    await writeHeartbeat({ pid: process.pid, probedAt: state.lastProbeAt });

    if (RESTART_ENABLED) {
      const gate = apiGateOpen(state.apiProbe);
      for (const agent of state.agents) {
        const decision = shouldRestart(agent, gate, state.lastProbeAt);
        if (decision.action !== "go") continue;
        console.log(`[supervisor] restarting ${agent.name}: ${decision.reason}`);
        const result = await performRestart(agent);
        runtimeMap.set(agent.name, result.runtime);
        agent.runtime = result.runtime;
        console.log(`[supervisor] restart ${agent.name} ok=${result.ok} ${result.detail}`);
      }
    }
  } catch (err) {
    console.error("[probe]", err);
  }
}

await probe();

setInterval(probe, PROBE_INTERVAL_MS);

startServer({ host: HOST, port: PORT, getState: () => state });

console.log(
  `[supervisor] vault=${VAULT_DIR} restart=${RESTART_ENABLED ? "ENABLED" : "off"}`,
);
