import { getDb } from '../db.js';

export interface EnvVarRow {
  key: string;
  value: string;
  is_secret: number;
  created_at: string;
}

export function setEnvVar(key: string, value: string, isSecret: boolean): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO env_vars (key, value, is_secret)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret
  `).run(key, value, isSecret ? 1 : 0);
}

export function removeEnvVar(key: string): void {
  const db = getDb();
  const result = db.prepare('DELETE FROM env_vars WHERE key = ?').run(key);
  if (result.changes === 0) {
    throw new Error(`Environment variable '${key}' not found`);
  }
}

export function listEnvVars(): EnvVarRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM env_vars ORDER BY key').all() as EnvVarRow[];
}

export function getAllEnvVars(): Map<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM env_vars').all() as EnvVarRow[];
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.key, row.value);
  }
  return map;
}
