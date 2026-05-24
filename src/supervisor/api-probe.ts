import type { ApiProbeState } from "./types.ts";

const PROBE_URL = "https://www.bing.com/";
const PROBE_TIMEOUT_MS = 5_000;

export function initialApiProbeState(): ApiProbeState {
  return {
    status: "unknown",
    lastOkAt: null,
    lastFailAt: null,
    consecutiveOkMs: 0,
    detail: null,
  };
}

export async function probeApi(prev: ApiProbeState, now: number): Promise<ApiProbeState> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(PROBE_URL, { method: "HEAD", signal: ac.signal });
    const reachable = res.status < 500;
    if (!reachable) {
      return {
        status: "down",
        lastOkAt: prev.lastOkAt,
        lastFailAt: now,
        consecutiveOkMs: 0,
        detail: `HTTP ${res.status}`,
      };
    }
    const consecutive = prev.status === "ok" && prev.lastOkAt
      ? prev.consecutiveOkMs + (now - prev.lastOkAt)
      : 0;
    return {
      status: "ok",
      lastOkAt: now,
      lastFailAt: prev.lastFailAt,
      consecutiveOkMs: consecutive,
      detail: null,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      status: "down",
      lastOkAt: prev.lastOkAt,
      lastFailAt: now,
      consecutiveOkMs: 0,
      detail,
    };
  } finally {
    clearTimeout(t);
  }
}

export function apiGateOpen(probe: ApiProbeState): boolean {
  return probe.status === "ok" && probe.consecutiveOkMs >= 60_000;
}
