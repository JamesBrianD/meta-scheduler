import { getDb, generateId } from '../db.js';
import { createConnector } from '../connectors/connector.js';
import { getWorkerByName, getWorkerById } from './worker.js';
import { getAllEnvVars } from './env.js';

export interface SlotRow {
  id: string;
  worker_id: string;
  name: string;
  tmux_session: string;
  cc_session_id: string | null;
  repo_url: string | null;
  work_path: string;
  prompt: string | null;
  status: string;
  created_at: string;
  last_active_at: string;
  worker_name?: string;
}

export interface RunSlotOpts {
  prompt: string;
  workerName: string;
  name?: string;
  repoUrl?: string;
  workPath?: string;
}

function truncatePrompt(prompt: string, maxLen = 30): string {
  const clean = prompt.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + '...';
}

export async function runSlot(opts: RunSlotOpts): Promise<SlotRow> {
  const worker = getWorkerByName(opts.workerName);
  if (!worker) {
    throw new Error(`Worker '${opts.workerName}' not found`);
  }

  const db = getDb();
  const activeSlots = db.prepare(
    `SELECT COUNT(*) as count FROM slots WHERE worker_id = ? AND status != 'dead'`
  ).get(worker.id) as { count: number };

  if (activeSlots.count >= worker.max_slots) {
    throw new Error(`Worker '${opts.workerName}' is at capacity (${worker.max_slots} slots)`);
  }

  const slotId = generateId();
  const workPath = opts.workPath ?? (opts.repoUrl ? `/tmp/ms-slot-${slotId}` : '~');

  // Check for active slot at the same work_path on the same worker
  const conflict = db.prepare(
    `SELECT id, name FROM slots WHERE worker_id = ? AND work_path = ? AND status != 'dead'`
  ).get(worker.id, workPath) as { id: string; name: string } | undefined;

  if (conflict) {
    throw new Error(
      `Work path '${workPath}' already has an active slot (${conflict.id}: ${conflict.name}). ` +
      `Use a different --path or kill the existing slot first.`
    );
  }

  const connector = createConnector(worker);
  const envVars = getAllEnvVars();
  const envObj = Object.fromEntries(envVars);

  // Delegate to ms-agent on the worker
  const agentArgs: Record<string, string> = {
    id: slotId,
    prompt: opts.prompt,
    path: workPath,
    'env-json': JSON.stringify(envObj),
  };
  if (opts.repoUrl) {
    agentArgs.repo = opts.repoUrl;
  }

  const result = await connector.agentExec('run', agentArgs);
  if (result.code !== 0) {
    throw new Error(`Agent error: ${result.stderr || result.stdout}`);
  }

  // Parse agent response
  const response = JSON.parse(result.stdout.trim());
  if (!response.ok) {
    throw new Error(response.error ?? 'Unknown agent error');
  }

  // Record in database
  const slotName = opts.name ?? truncatePrompt(opts.prompt);
  db.prepare(`
    INSERT INTO slots (id, worker_id, name, tmux_session, repo_url, work_path, prompt, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'running')
  `).run(slotId, worker.id, slotName, `slot-${slotId}`, opts.repoUrl ?? null, workPath, opts.prompt);

  return getSlotById(slotId)!;
}

export function listSlots(includeAll = false): SlotRow[] {
  const db = getDb();
  // Auto-clean dead slots older than 3 days
  db.prepare(`DELETE FROM slots WHERE status = 'dead' AND last_active_at < datetime('now', '-3 days')`).run();

  if (includeAll) {
    return db.prepare(`
      SELECT s.*, w.name as worker_name
      FROM slots s
      JOIN workers w ON s.worker_id = w.id
      ORDER BY s.created_at DESC
    `).all() as SlotRow[];
  }
  return db.prepare(`
    SELECT s.*, w.name as worker_name
    FROM slots s
    JOIN workers w ON s.worker_id = w.id
    WHERE s.status != 'dead'
    ORDER BY s.created_at DESC
  `).all() as SlotRow[];
}

export function getSlotById(id: string): SlotRow | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT s.*, w.name as worker_name
    FROM slots s
    JOIN workers w ON s.worker_id = w.id
    WHERE s.id = ?
  `).get(id) as SlotRow | undefined;
}

export async function attachSlot(slotId: string): Promise<void> {
  const slot = getSlotById(slotId);
  if (!slot) {
    throw new Error(`Slot '${slotId}' not found`);
  }

  const worker = getWorkerById(slot.worker_id);
  if (!worker) {
    throw new Error(`Worker for slot '${slotId}' not found`);
  }

  const connector = createConnector(worker);
  const envVars = getAllEnvVars();
  const envObj = Object.fromEntries(envVars);

  const agentArgs: Record<string, string> = {
    id: slotId,
    'env-json': JSON.stringify(envObj),
  };
  if (slot.status === 'dead') {
    agentArgs.resume = 'true';
  }

  connector.agentInteractive('attach', agentArgs);

  // Update status if we resumed a dead slot
  if (slot.status === 'dead') {
    const db = getDb();
    db.prepare(`UPDATE slots SET status = 'running' WHERE id = ?`).run(slotId);
  }
}

export async function getSlotResult(slotId: string): Promise<{ result: string; sessionId: string | null; cost: number | null } | null> {
  const slot = getSlotById(slotId);
  if (!slot) {
    throw new Error(`Slot '${slotId}' not found`);
  }

  const worker = getWorkerById(slot.worker_id);
  if (!worker) {
    throw new Error(`Worker for slot '${slotId}' not found`);
  }

  const connector = createConnector(worker);
  const result = await connector.agentExec('logs', { id: slotId });
  if (result.code !== 0) {
    return null;
  }

  const parsed = JSON.parse(result.stdout.trim());
  if (!parsed) return null;

  // Save session_id to DB if found
  if (parsed.sessionId) {
    const db = getDb();
    db.prepare(`UPDATE slots SET cc_session_id = ? WHERE id = ?`).run(parsed.sessionId, slotId);
  }

  return parsed;
}

export async function killSlot(slotId: string): Promise<void> {
  const slot = getSlotById(slotId);
  if (!slot) {
    throw new Error(`Slot '${slotId}' not found`);
  }

  const worker = getWorkerById(slot.worker_id);
  if (!worker) {
    throw new Error(`Worker for slot '${slotId}' not found`);
  }

  const connector = createConnector(worker);
  await connector.agentExec('kill', { id: slotId });

  const db = getDb();
  db.prepare(`UPDATE slots SET status = 'dead' WHERE id = ?`).run(slotId);
}

export async function syncSlotStatuses(workerName?: string): Promise<void> {
  const db = getDb();

  let workers;
  if (workerName) {
    const w = getWorkerByName(workerName);
    workers = w ? [w] : [];
  } else {
    workers = db.prepare('SELECT * FROM workers WHERE status = ?').all('active') as import('../connectors/connector.js').WorkerRow[];
  }

  for (const worker of workers) {
    const connector = createConnector(worker);

    // Ask agent for all slot statuses
    const result = await connector.agentExec('status', {});
    if (result.code !== 0) continue;

    let statuses: Array<{ id: string; status: string }>;
    try {
      statuses = JSON.parse(result.stdout.trim());
    } catch {
      continue;
    }

    const agentStatusMap = new Map(statuses.map(s => [s.id, s.status]));

    // Get all non-dead slots for this worker
    const slots = db.prepare(
      `SELECT * FROM slots WHERE worker_id = ? AND status != 'dead'`
    ).all(worker.id) as SlotRow[];

    for (const slot of slots) {
      const agentStatus = agentStatusMap.get(slot.id);

      if (!agentStatus || agentStatus === 'dead') {
        db.prepare(`UPDATE slots SET status = 'dead' WHERE id = ?`).run(slot.id);
      } else if (agentStatus === 'running') {
        db.prepare(`UPDATE slots SET status = 'running', last_active_at = CURRENT_TIMESTAMP WHERE id = ?`).run(slot.id);
      } else {
        db.prepare(`UPDATE slots SET status = 'idle' WHERE id = ?`).run(slot.id);
      }
    }
  }
}
