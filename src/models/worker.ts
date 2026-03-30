import { getDb, generateId } from '../db.js';
import type { WorkerRow } from '../connectors/connector.js';

export interface AddWorkerOpts {
  name: string;
  type: 'ssh' | 'k8s' | 'local';
  config: Record<string, string>;
  maxSlots?: number;
}

export function addWorker(opts: AddWorkerOpts): WorkerRow {
  if (opts.type === 'ssh') {
    if (!opts.config.host || !opts.config.user) {
      throw new Error('SSH worker requires --host and --user');
    }
  }
  if (opts.type === 'k8s') {
    if (!opts.config.pod) {
      throw new Error('K8s worker requires --pod');
    }
  }

  const db = getDb();
  const id = generateId();
  const configJson = JSON.stringify(opts.config);

  try {
    db.prepare(`
      INSERT INTO workers (id, name, type, config_json, max_slots)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, opts.name, opts.type, configJson, opts.maxSlots ?? 3);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error(`Worker '${opts.name}' already exists`);
    }
    throw err;
  }

  return getWorkerByName(opts.name)!;
}

export function removeWorker(name: string): void {
  const db = getDb();
  const worker = getWorkerByName(name);
  if (!worker) {
    throw new Error(`Worker '${name}' not found`);
  }

  const activeSlots = db.prepare(
    `SELECT COUNT(*) as count FROM slots WHERE worker_id = ? AND status != 'dead'`
  ).get(worker.id) as { count: number };

  if (activeSlots.count > 0) {
    throw new Error(`Worker '${name}' has ${activeSlots.count} active slot(s). Kill them first.`);
  }

  // Clean up dead slots before removing worker (foreign key constraint)
  db.prepare('DELETE FROM slots WHERE worker_id = ? AND status = ?').run(worker.id, 'dead');
  db.prepare('DELETE FROM workers WHERE id = ?').run(worker.id);
}

export function listWorkers(): WorkerRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM workers ORDER BY created_at').all() as WorkerRow[];
}

export function getWorkerByName(name: string): WorkerRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM workers WHERE name = ?').get(name) as WorkerRow | undefined;
}

export function getWorkerById(id: string): WorkerRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM workers WHERE id = ?').get(id) as WorkerRow | undefined;
}
