import { resolve } from "node:path";
import { startServer } from "./dashboard/server.ts";
import { readVault } from "./supervisor/vault.ts";
import type { SupervisorState } from "./supervisor/types.ts";

const VAULT_DIR = process.env.VAULT_DIR
  ? resolve(process.env.VAULT_DIR)
  : resolve(process.cwd(), "private/agents");
const HOST = process.env.BIND_HOST ?? "127.0.0.1";
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 7421;
const PROBE_INTERVAL_MS = 5_000;

const state: SupervisorState = {
  startedAt: Date.now(),
  lastProbeAt: null,
  vaultDir: VAULT_DIR,
  agents: [],
};

async function probe() {
  try {
    state.agents = await readVault(VAULT_DIR);
    state.lastProbeAt = Date.now();
  } catch (err) {
    console.error("[probe]", err);
  }
}

await probe();

setInterval(probe, PROBE_INTERVAL_MS);

startServer({ host: HOST, port: PORT, getState: () => state });

console.log(`[supervisor] vault=${VAULT_DIR}`);
