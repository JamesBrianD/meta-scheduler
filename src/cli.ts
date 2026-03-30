import { Command } from 'commander';
import chalk from 'chalk';
import { addWorker, removeWorker, listWorkers, getWorkerByName } from './models/worker.js';
import { runSlot, listSlots, attachSlot, killSlot, syncSlotStatuses, getSlotResult } from './models/slot.js';
import { setEnvVar, removeEnvVar, listEnvVars } from './models/env.js';
import { createConnector } from './connectors/connector.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const program = new Command();

program
  .name('ms')
  .description('Meta-scheduler: manage Claude Code instances across remote workers')
  .version('0.1.0');

// --- Helper ---

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length))
  );

  const header = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  console.log(chalk.dim(header));
  console.log(chalk.dim('─'.repeat(header.length)));

  for (const row of rows) {
    console.log(row.map((c, i) => (c ?? '').padEnd(widths[i])).join('  '));
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'running': return chalk.green(status);
    case 'idle': return chalk.yellow(status);
    case 'dead': return chalk.red(status);
    case 'active': return chalk.green(status);
    case 'inactive': return chalk.red(status);
    default: return status;
  }
}

// --- Worker commands ---

const worker = program.command('worker').description('Manage workers');

worker
  .command('add <name>')
  .description('Register a worker')
  .requiredOption('--type <type>', 'Worker type: ssh, k8s, or local')
  .option('--host <host>', 'SSH host')
  .option('--user <user>', 'SSH user')
  .option('--key <key>', 'SSH private key path')
  .option('--pod <pod>', 'K8s pod name')
  .option('--namespace <ns>', 'K8s namespace', 'default')
  .option('--container <container>', 'K8s container name')
  .option('--max-slots <n>', 'Max concurrent CC slots', '3')
  .action((name: string, opts: { type: string; host?: string; user?: string; key?: string; pod?: string; namespace: string; container?: string; maxSlots: string }) => {
    try {
      const config: Record<string, string> = {};
      if (opts.host) config.host = opts.host;
      if (opts.user) config.user = opts.user;
      if (opts.key) config.key = opts.key;
      if (opts.pod) config.pod = opts.pod;
      if (opts.namespace !== 'default') config.namespace = opts.namespace;
      if (opts.container) config.container = opts.container;

      const w = addWorker({
        name,
        type: opts.type as 'ssh' | 'k8s' | 'local',
        config,
        maxSlots: parseInt(opts.maxSlots, 10),
      });
      console.log(chalk.green(`Worker '${w.name}' added (type: ${w.type}, max slots: ${w.max_slots})`));
    } catch (err: unknown) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

worker
  .command('remove <name>')
  .description('Remove a worker')
  .action((name: string) => {
    try {
      removeWorker(name);
      console.log(chalk.green(`Worker '${name}' removed`));
    } catch (err: unknown) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

worker
  .command('list')
  .description('List all workers')
  .action(() => {
    const workers = listWorkers();
    if (workers.length === 0) {
      console.log(chalk.dim('No workers registered. Use `ms worker add` to add one.'));
      return;
    }
    const rows = workers.map(w => {
      const config = JSON.parse(w.config_json);
      const info = w.type === 'ssh' ? `${config.user}@${config.host}` :
                   w.type === 'k8s' ? `${config.pod}${config.namespace ? '@' + config.namespace : ''}` :
                   'localhost';
      return [w.name, w.type, info, String(w.max_slots), statusColor(w.status)];
    });
    printTable(['Name', 'Type', 'Connection', 'Max Slots', 'Status'], rows);
  });

worker
  .command('setup <name>')
  .description('Deploy ms-agent binary to a worker')
  .action(async (name: string) => {
    try {
      const w = getWorkerByName(name);
      if (!w) {
        throw new Error(`Worker '${name}' not found`);
      }

      const connector = createConnector(w);

      // Resolve path to the built agent-cli.js
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const agentPath = resolve(__dirname, 'agent-cli.js');

      if (w.type === 'local') {
        // For local workers, ms-agent should already be available via npm link
        const check = await connector.exec('which ms-agent');
        if (check.code === 0) {
          console.log(chalk.green(`ms-agent already available on local worker at ${check.stdout.trim()}`));
        } else {
          console.log(chalk.yellow('ms-agent not in PATH. Run `npm run build && npm link` to install it.'));
        }
        return;
      }

      if (w.type === 'ssh') {
        const config = JSON.parse(w.config_json);
        const scpArgs = [agentPath, `${config.user}@${config.host}:~/.local/bin/ms-agent`];
        if (config.key) {
          scpArgs.unshift('-i', config.key);
        }
        const { spawnSync } = await import('node:child_process');
        // Ensure target directory exists
        await connector.exec('mkdir -p ~/.local/bin');
        // SCP the file
        const scpResult = spawnSync('scp', scpArgs, { stdio: 'inherit' });
        if (scpResult.status !== 0) {
          throw new Error('scp failed');
        }
        // Make executable
        await connector.exec('chmod +x ~/.local/bin/ms-agent');
      } else if (w.type === 'k8s') {
        const config = JSON.parse(w.config_json);
        const { spawnSync } = await import('node:child_process');
        const cpArgs = ['cp', agentPath, `${config.namespace ?? 'default'}/${config.pod}:/usr/local/bin/ms-agent`];
        if (config.container) {
          cpArgs.push('-c', config.container);
        }
        const cpResult = spawnSync('kubectl', cpArgs, { stdio: 'inherit' });
        if (cpResult.status !== 0) {
          throw new Error('kubectl cp failed');
        }
        await connector.exec('chmod +x /usr/local/bin/ms-agent');
      }

      // Verify
      const verify = await connector.exec('ms-agent --version');
      if (verify.code === 0) {
        console.log(chalk.green(`ms-agent deployed to '${name}' (${verify.stdout.trim()})`));
      } else {
        console.log(chalk.yellow(`ms-agent deployed but version check failed. It may not be in PATH.`));
      }
    } catch (err: unknown) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// --- Env commands ---

const env = program.command('env').description('Manage environment variables injected into slots');

env
  .command('set <key> <value>')
  .description('Set an environment variable (use --secret to hide value in list)')
  .option('--secret', 'Mark as secret (value hidden in `ms env list`)')
  .action((key: string, value: string, opts: { secret?: boolean }) => {
    try {
      setEnvVar(key, value, opts.secret ?? false);
      console.log(chalk.green(`Set ${key}${opts.secret ? ' (secret)' : ''}`));
    } catch (err: unknown) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

env
  .command('remove <key>')
  .description('Remove an environment variable')
  .action((key: string) => {
    try {
      removeEnvVar(key);
      console.log(chalk.green(`Removed ${key}`));
    } catch (err: unknown) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

env
  .command('list')
  .description('List all environment variables')
  .action(() => {
    const vars = listEnvVars();
    if (vars.length === 0) {
      console.log(chalk.dim('No environment variables configured. Use `ms env set` to add one.'));
      return;
    }
    const rows = vars.map(v => [
      v.key,
      v.is_secret ? chalk.dim('********') : v.value,
      v.is_secret ? chalk.yellow('secret') : '',
    ]);
    printTable(['Key', 'Value', ''], rows);
  });

// --- Slot commands ---

program
  .command('run <prompt>')
  .description('Run a new Claude Code instance on a worker')
  .requiredOption('--worker <name>', 'Target worker name')
  .option('--name <name>', 'Slot name (defaults to prompt preview)')
  .option('--repo <url>', 'Git repository to clone')
  .option('--path <path>', 'Working directory on the worker')
  .action(async (prompt: string, opts: { worker: string; name?: string; repo?: string; path?: string }) => {
    try {
      const slot = await runSlot({
        prompt,
        workerName: opts.worker,
        name: opts.name,
        repoUrl: opts.repo,
        workPath: opts.path,
      });
      console.log(chalk.green(`Slot ${slot.id} started on worker '${slot.worker_name}'`));
      console.log(`  name:         ${slot.name}`);
      console.log(`  work path:    ${slot.work_path}`);
      console.log(`  attach:       ms attach ${slot.id}`);
    } catch (err: unknown) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List slots (hides dead by default)')
  .option('--all', 'Include dead slots')
  .action(async (opts: { all?: boolean }) => {
    try {
      await syncSlotStatuses();
    } catch {
      // Sync failures are non-fatal — show stale data
    }

    const slots = listSlots(opts.all ?? false);
    if (slots.length === 0) {
      console.log(chalk.dim('No active slots. Use `ms run` to start one.'));
      return;
    }
    const rows = slots.map(s => [
      s.id,
      s.name,
      s.worker_name ?? '?',
      statusColor(s.status),
      s.work_path,
      s.created_at,
    ]);
    printTable(['Slot ID', 'Name', 'Worker', 'Status', 'Work Path', 'Created'], rows);
  });

program
  .command('logs <slot-id>')
  .description('Show the result of a slot\'s task')
  .action(async (slotId: string) => {
    try {
      const result = await getSlotResult(slotId);
      if (!result) {
        console.log(chalk.dim('No result yet (task may still be running).'));
        return;
      }
      console.log(result.result);
      if (result.cost !== null) {
        console.log(chalk.dim(`\n--- cost: $${result.cost.toFixed(4)} ---`));
      }
    } catch (err: unknown) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program
  .command('attach <slot-id>')
  .description('Attach to a slot (resumes with claude --resume if dead)')
  .action(async (slotId: string) => {
    try {
      await attachSlot(slotId);
    } catch (err: unknown) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program
  .command('kill <slot-id>')
  .description('Kill a slot\'s tmux session')
  .action(async (slotId: string) => {
    try {
      await killSlot(slotId);
      console.log(chalk.green(`Slot ${slotId} killed`));
    } catch (err: unknown) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.parse();
