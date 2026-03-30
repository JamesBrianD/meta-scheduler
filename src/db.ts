import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

let db: Database.Database | null = null;

const DB_DIR = join(homedir(), '.meta-scheduler');
const DB_PATH = join(DB_DIR, 'meta-scheduler.db');

export function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('ssh', 'k8s', 'local')),
      config_json TEXT NOT NULL,
      max_slots INTEGER DEFAULT 3,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS slots (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL REFERENCES workers(id),
      name TEXT NOT NULL,
      tmux_session TEXT NOT NULL,
      cc_session_id TEXT,
      repo_url TEXT,
      work_path TEXT NOT NULL,
      prompt TEXT,
      status TEXT DEFAULT 'running' CHECK (status IN ('running', 'idle', 'dead')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      priority TEXT DEFAULT 'normal' CHECK (priority IN ('critical', 'high', 'normal', 'low')),
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched', 'running', 'done', 'failed')),
      depends_on TEXT,
      target_worker TEXT,
      target_slot TEXT,
      repo_url TEXT,
      work_path TEXT,
      slot_id TEXT REFERENCES slots(id),
      pr_url TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER REFERENCES tasks(id),
      slot_id TEXT REFERENCES slots(id),
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      level TEXT DEFAULT 'info',
      message TEXT
    );

    CREATE TABLE IF NOT EXISTS env_vars (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      is_secret INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migrations: add columns if missing
  const slotColumns = db.pragma('table_info(slots)') as { name: string }[];
  const colNames = new Set(slotColumns.map(c => c.name));
  if (!colNames.has('name')) {
    db.exec(`ALTER TABLE slots ADD COLUMN name TEXT NOT NULL DEFAULT ''`);
  }
  if (!colNames.has('prompt')) {
    db.exec(`ALTER TABLE slots ADD COLUMN prompt TEXT`);
  }

  return db;
}

export function generateId(): string {
  return randomUUID().slice(0, 8);
}
