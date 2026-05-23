import { readFile } from "node:fs/promises";
import { agentRestartLog } from "../supervisor/heartbeat.ts";

export interface RestartLogEntry {
  iso: string;
  ok: boolean;
  reason: string;
  detail: string | null;
}

const LINE_RE = /^(\S+)\s+ok=(\S+)\s+reason=(.+?)(?:\s+detail=(.+))?$/;

export async function readRestartLog(agentName: string, max = 25): Promise<RestartLogEntry[]> {
  let raw: string;
  try {
    raw = await readFile(agentRestartLog(agentName), "utf8");
  } catch {
    return [];
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const tail = lines.slice(-max).reverse();
  const out: RestartLogEntry[] = [];
  for (const line of tail) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const [, iso, okStr, reasonRaw, detailRaw] = m;
    out.push({
      iso,
      ok: okStr === "true",
      reason: tryParse(reasonRaw),
      detail: detailRaw ? tryParse(detailRaw) : null,
    });
  }
  return out;
}

function tryParse(s: string): string {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
