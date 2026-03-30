import { exec as execCb, execSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';

const execAsync = promisify(execCb);

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function localExec(command: string): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      code: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// --- Find claude binary ---

async function findClaudeBinary(): Promise<string> {
  const whichResult = await localExec('which claude 2>/dev/null');
  if (whichResult.code === 0 && whichResult.stdout.trim()) {
    return whichResult.stdout.trim();
  }

  const searchResult = await localExec(
    'for d in "$HOME/.local/bin" "$HOME/.claude/bin" "/usr/local/bin" "/usr/bin"; do ' +
    '  if [ -x "$d/claude" ]; then echo "$d/claude"; exit 0; fi; ' +
    'done; exit 1'
  );
  if (searchResult.code === 0 && searchResult.stdout.trim()) {
    return searchResult.stdout.trim().split('\n')[0];
  }

  const findResult = await localExec('find "$HOME" -name claude -type f 2>/dev/null | head -1');
  if (findResult.code === 0 && findResult.stdout.trim()) {
    return findResult.stdout.trim();
  }

  throw new Error('claude binary not found. Install Claude Code first.');
}

// --- Build tmux command ---

function buildTmuxRunCommand(
  slotId: string,
  workPath: string,
  prompt: string,
  claudePath: string,
  envVars: Record<string, string>,
): string {
  const envExports = Object.entries(envVars)
    .map(([k, v]) => `export ${k}=${shellEscape(v)}`)
    .join('; ');
  const envPrefix = envExports ? `${envExports}; ` : '';

  const logFile = `/tmp/ms-slot-${slotId}.log`;
  const claudeCmd = `${envPrefix}IS_SANDBOX=1 ${claudePath} -p ${shellEscape(prompt)} --dangerously-skip-permissions --output-format stream-json --verbose > ${logFile} 2>&1`;
  const fullCmd = `cd ${shellEscape(workPath)} && ${claudeCmd}`;

  return `tmux new-session -d -s slot-${slotId} -x 200 -y 50 ${shellEscape(fullCmd)}`;
}

// --- Slot operations ---

export interface RunSlotLocalOpts {
  id: string;
  prompt: string;
  path: string;
  repo?: string;
  envVars: Record<string, string>;
}

export interface SlotStatus {
  id: string;
  status: 'running' | 'idle' | 'dead';
}

export interface SlotResult {
  result: string;
  sessionId: string | null;
  cost: number | null;
}

export async function runSlotLocal(opts: RunSlotLocalOpts): Promise<{ ok: true } | { ok: false; error: string }> {
  // Pre-flight: check tmux
  const tmuxCheck = await localExec('which tmux');
  if (tmuxCheck.code !== 0) {
    return { ok: false, error: 'tmux not found. Install it first.' };
  }

  // Clone repo if specified
  if (opts.repo) {
    const cloneCmd = `git clone --branch main --single-branch ${shellEscape(opts.repo)} /tmp/ms-slot-${opts.id}`;
    const cloneResult = await localExec(cloneCmd);
    if (cloneResult.code !== 0) {
      return { ok: false, error: `Git clone failed: ${cloneResult.stderr}` };
    }
  }

  // Find claude binary
  let claudePath: string;
  try {
    claudePath = await findClaudeBinary();
  } catch (err: unknown) {
    return { ok: false, error: (err as Error).message };
  }

  // Start tmux session
  const tmuxCmd = buildTmuxRunCommand(opts.id, opts.path, opts.prompt, claudePath, opts.envVars);
  const tmuxResult = await localExec(tmuxCmd);
  if (tmuxResult.code !== 0) {
    return { ok: false, error: `Failed to start tmux session: ${tmuxResult.stderr}` };
  }

  return { ok: true };
}

export async function getStatusLocal(slotId?: string): Promise<SlotStatus[]> {
  const sessionsResult = await localExec(
    "tmux list-sessions -F '#{session_name}:#{pane_pid}' 2>/dev/null"
  );

  const sessionMap = new Map<string, string>();
  if (sessionsResult.code === 0 && sessionsResult.stdout.trim()) {
    for (const line of sessionsResult.stdout.trim().split('\n')) {
      const [name, pid] = line.split(':');
      if (name && pid) {
        sessionMap.set(name, pid);
      }
    }
  }

  // If specific slot requested
  if (slotId) {
    const sessionName = `slot-${slotId}`;
    const pid = sessionMap.get(sessionName);
    if (!pid) {
      return [{ id: slotId, status: 'dead' }];
    }
    const psResult = await localExec(`ps -p ${pid} > /dev/null 2>&1 && echo alive || echo dead`);
    const isAlive = psResult.stdout.trim() === 'alive';
    return [{ id: slotId, status: isAlive ? 'running' : 'idle' }];
  }

  // Return status for all ms-agent slots
  const results: SlotStatus[] = [];
  for (const [name, pid] of sessionMap) {
    if (!name.startsWith('slot-')) continue;
    const id = name.slice(5); // remove 'slot-' prefix
    const psResult = await localExec(`ps -p ${pid} > /dev/null 2>&1 && echo alive || echo dead`);
    const isAlive = psResult.stdout.trim() === 'alive';
    results.push({ id, status: isAlive ? 'running' : 'idle' });
  }
  return results;
}

export async function getLogsLocal(slotId: string): Promise<SlotResult | null> {
  const logFile = `/tmp/ms-slot-${slotId}.log`;
  let content: string;
  try {
    content = readFileSync(logFile, 'utf-8');
  } catch {
    return null;
  }

  if (!content.trim()) return null;

  let sessionId: string | null = null;
  let result: string | null = null;
  let cost: number | null = null;

  for (const line of content.trim().split('\n')) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'system' && obj.subtype === 'init' && obj.session_id) {
        sessionId = obj.session_id;
      }
      if (obj.type === 'result') {
        result = obj.result ?? null;
        cost = obj.total_cost_usd ?? null;
      }
    } catch {
      // Not JSON
    }
  }

  if (!result) {
    return { result: content.trim(), sessionId, cost: null };
  }
  return { result, sessionId, cost };
}

export async function killSlotLocal(slotId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await localExec(`tmux kill-session -t slot-${slotId} 2>/dev/null`);
  // Always return ok — if session doesn't exist, it's already dead
  return { ok: true };
}

export function attachSlotLocal(slotId: string, opts?: { resume?: boolean; envVars?: Record<string, string> }): void {
  const sessionName = `slot-${slotId}`;

  // Check if tmux session exists
  const checkResult = spawnSync('tmux', ['has-session', '-t', sessionName], { stdio: 'pipe' });

  if (checkResult.status === 0) {
    // Session exists — direct attach
    spawnSync('tmux', ['attach', '-t', sessionName], { stdio: 'inherit' });
    return;
  }

  if (!opts?.resume) {
    // No session and no resume — can't attach
    console.error(JSON.stringify({ ok: false, error: `Session ${sessionName} not found and --resume not set` }));
    process.exit(1);
  }

  // Resume: find session_id from log
  const logFile = `/tmp/ms-slot-${slotId}.log`;
  let sessionId: string | null = null;
  try {
    const content = readFileSync(logFile, 'utf-8');
    for (const line of content.trim().split('\n')) {
      try {
        const obj = JSON.parse(line);
        if (obj.session_id) {
          sessionId = obj.session_id;
          break;
        }
      } catch {
        const match = line.match(/session[_ ]id[:\s]+([0-9a-f-]{36})/i);
        if (match) {
          sessionId = match[1];
          break;
        }
      }
    }
  } catch {
    console.error(JSON.stringify({ ok: false, error: 'No log file found for resume' }));
    process.exit(1);
  }

  if (!sessionId) {
    console.error(JSON.stringify({ ok: false, error: 'No session ID found in logs. Cannot resume.' }));
    process.exit(1);
  }

  // Find claude and build resume command
  const claudePath = execSync('which claude 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim();
  if (!claudePath) {
    console.error(JSON.stringify({ ok: false, error: 'claude binary not found for resume' }));
    process.exit(1);
  }

  const envVars = opts.envVars ?? {};
  const envExports = Object.entries(envVars)
    .map(([k, v]) => `export ${k}=${shellEscape(v)}`)
    .join('; ');
  const envPrefix = envExports ? `${envExports}; ` : '';

  const resumeCmd = `${envPrefix}IS_SANDBOX=1 cd ${shellEscape('/tmp')} && ${claudePath} --resume ${sessionId} --dangerously-skip-permissions`;
  const tmuxCmd = `tmux new-session -d -s ${sessionName} -x 200 -y 50 ${shellEscape(resumeCmd)}`;

  execSync(tmuxCmd);
  spawnSync('tmux', ['attach', '-t', sessionName], { stdio: 'inherit' });
}
