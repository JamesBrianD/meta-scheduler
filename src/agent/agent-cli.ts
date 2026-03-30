import { Command } from 'commander';
import {
  runSlotLocal,
  getStatusLocal,
  getLogsLocal,
  killSlotLocal,
  attachSlotLocal,
} from './slot-manager.js';

const program = new Command();

program
  .name('ms-agent')
  .description('Meta-scheduler worker agent — manages tmux/claude sessions locally')
  .version('0.1.0');

program
  .command('run')
  .description('Start a new Claude Code slot in tmux')
  .requiredOption('--id <id>', 'Slot ID')
  .requiredOption('--prompt <prompt>', 'Prompt to send to claude')
  .requiredOption('--path <path>', 'Working directory')
  .option('--repo <url>', 'Git repository to clone')
  .option('--env-json <json>', 'Environment variables as JSON object', '{}')
  .action(async (opts: { id: string; prompt: string; path: string; repo?: string; envJson: string }) => {
    try {
      const envVars = JSON.parse(opts.envJson) as Record<string, string>;
      const result = await runSlotLocal({
        id: opts.id,
        prompt: opts.prompt,
        path: opts.path,
        repo: opts.repo,
        envVars,
      });
      console.log(JSON.stringify(result));
    } catch (err: unknown) {
      console.log(JSON.stringify({ ok: false, error: (err as Error).message }));
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Get status of slot(s)')
  .option('--id <id>', 'Specific slot ID (omit for all)')
  .action(async (opts: { id?: string }) => {
    try {
      const statuses = await getStatusLocal(opts.id);
      console.log(JSON.stringify(statuses));
    } catch (err: unknown) {
      console.log(JSON.stringify({ error: (err as Error).message }));
      process.exit(1);
    }
  });

program
  .command('logs')
  .description('Get logs/result of a slot')
  .requiredOption('--id <id>', 'Slot ID')
  .action(async (opts: { id: string }) => {
    try {
      const result = await getLogsLocal(opts.id);
      console.log(JSON.stringify(result));
    } catch (err: unknown) {
      console.log(JSON.stringify({ error: (err as Error).message }));
      process.exit(1);
    }
  });

program
  .command('kill')
  .description('Kill a slot\'s tmux session')
  .requiredOption('--id <id>', 'Slot ID')
  .action(async (opts: { id: string }) => {
    try {
      const result = await killSlotLocal(opts.id);
      console.log(JSON.stringify(result));
    } catch (err: unknown) {
      console.log(JSON.stringify({ error: (err as Error).message }));
      process.exit(1);
    }
  });

program
  .command('attach')
  .description('Attach to a slot\'s tmux session (interactive)')
  .requiredOption('--id <id>', 'Slot ID')
  .option('--resume', 'Resume a dead session using claude --resume')
  .option('--env-json <json>', 'Environment variables as JSON object', '{}')
  .action((opts: { id: string; resume?: boolean; envJson: string }) => {
    try {
      const envVars = JSON.parse(opts.envJson) as Record<string, string>;
      attachSlotLocal(opts.id, { resume: opts.resume, envVars });
    } catch (err: unknown) {
      console.error(JSON.stringify({ error: (err as Error).message }));
      process.exit(1);
    }
  });

program.parse();
