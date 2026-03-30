import { exec as execCb, execFile as execFileCb, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(execCb);
const execFileAsync = promisify(execFileCb);

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface Connector {
  exec(command: string): Promise<ExecResult>;
  interactive(command: string): void;
  agentExec(subcommand: string, args: Record<string, string>): Promise<ExecResult>;
  agentInteractive(subcommand: string, args: Record<string, string>): void;
  type: 'ssh' | 'k8s' | 'local';
}

export interface WorkerRow {
  id: string;
  name: string;
  type: 'ssh' | 'k8s' | 'local';
  config_json: string;
  max_slots: number;
  status: string;
  created_at: string;
}

export interface SSHConfig {
  host: string;
  user: string;
  key?: string;
}

export interface K8sConfig {
  pod: string;
  namespace?: string;
  container?: string;
}

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Convert {key: value} to ['--key', 'value', ...] array */
function argsToArray(args: Record<string, string>): string[] {
  const result: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    result.push(`--${k}`, v);
  }
  return result;
}

export function createConnector(worker: WorkerRow): Connector {
  const config = JSON.parse(worker.config_json);
  switch (worker.type) {
    case 'ssh':
      return new SSHConnector(config);
    case 'local':
      return new LocalConnector();
    case 'k8s':
      return new K8sConnector(config);
  }
}

class LocalConnector implements Connector {
  type = 'local' as const;

  async exec(command: string): Promise<ExecResult> {
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

  interactive(command: string): void {
    spawnSync('bash', ['-c', command], { stdio: 'inherit' });
  }

  async agentExec(subcommand: string, args: Record<string, string>): Promise<ExecResult> {
    const flatArgs = [subcommand, ...argsToArray(args)];
    try {
      const { stdout, stderr } = await execFileAsync('ms-agent', flatArgs, { maxBuffer: 10 * 1024 * 1024 });
      return { stdout: stdout as string, stderr: stderr as string, code: 0 };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return {
        stdout: (e.stdout as string) ?? '',
        stderr: (e.stderr as string) ?? '',
        code: typeof e.code === 'number' ? e.code : 1,
      };
    }
  }

  agentInteractive(subcommand: string, args: Record<string, string>): void {
    const flatArgs = [subcommand, ...argsToArray(args)];
    spawnSync('ms-agent', flatArgs, { stdio: 'inherit' });
  }
}

class SSHConnector implements Connector {
  type = 'ssh' as const;
  private host: string;
  private user: string;
  private key?: string;

  constructor(config: SSHConfig) {
    this.host = config.host;
    this.user = config.user;
    this.key = config.key;
  }

  private sshArgs(): string[] {
    const args = [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=10',
    ];
    if (this.key) {
      args.push('-i', this.key);
    }
    return args;
  }

  async exec(command: string): Promise<ExecResult> {
    const args = this.sshArgs();
    const target = `${this.user}@${this.host}`;
    const fullCmd = `ssh ${args.map(shellEscape).join(' ')} ${shellEscape(target)} ${shellEscape(command)}`;
    try {
      const { stdout, stderr } = await execAsync(fullCmd, { maxBuffer: 10 * 1024 * 1024 });
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

  interactive(command: string): void {
    const args = ['-t', ...this.sshArgs(), `${this.user}@${this.host}`, command];
    spawnSync('ssh', args, { stdio: 'inherit' });
  }

  async agentExec(subcommand: string, args: Record<string, string>): Promise<ExecResult> {
    // Build: ssh user@host ms-agent <subcommand> --key value ...
    // Each arg value is shell-escaped for the SSH layer
    const agentArgs = argsToArray(args).map(shellEscape).join(' ');
    const remoteCmd = `ms-agent ${subcommand} ${agentArgs}`;
    return this.exec(remoteCmd);
  }

  agentInteractive(subcommand: string, args: Record<string, string>): void {
    const agentArgs = argsToArray(args).map(shellEscape).join(' ');
    const remoteCmd = `ms-agent ${subcommand} ${agentArgs}`;
    this.interactive(remoteCmd);
  }
}

class K8sConnector implements Connector {
  type = 'k8s' as const;
  private pod: string;
  private namespace: string;
  private container?: string;

  constructor(config: K8sConfig) {
    this.pod = config.pod;
    this.namespace = config.namespace ?? 'default';
    this.container = config.container;
  }

  private baseArgs(): string[] {
    const args = ['exec', this.pod, '-n', this.namespace];
    if (this.container) {
      args.push('-c', this.container);
    }
    return args;
  }

  async exec(command: string): Promise<ExecResult> {
    const args = [...this.baseArgs(), '--', 'bash', '-c', command];
    const fullCmd = `kubectl ${args.map(shellEscape).join(' ')}`;
    try {
      const { stdout, stderr } = await execAsync(fullCmd, { maxBuffer: 10 * 1024 * 1024 });
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

  interactive(command: string): void {
    const args = [...this.baseArgs(), '-it', '--', 'bash', '-c', command];
    spawnSync('kubectl', args, { stdio: 'inherit' });
  }

  async agentExec(subcommand: string, args: Record<string, string>): Promise<ExecResult> {
    // kubectl exec pod -- ms-agent <subcommand> --key value ...
    // No shell escaping needed — execFile-style through kubectl
    const flatArgs = [...this.baseArgs(), '--', 'ms-agent', subcommand, ...argsToArray(args)];
    try {
      const { stdout, stderr } = await execFileAsync('kubectl', flatArgs, { maxBuffer: 10 * 1024 * 1024 });
      return { stdout: stdout as string, stderr: stderr as string, code: 0 };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return {
        stdout: (e.stdout as string) ?? '',
        stderr: (e.stderr as string) ?? '',
        code: typeof e.code === 'number' ? e.code : 1,
      };
    }
  }

  agentInteractive(subcommand: string, args: Record<string, string>): void {
    const flatArgs = [...this.baseArgs(), '-it', '--', 'ms-agent', subcommand, ...argsToArray(args)];
    spawnSync('kubectl', flatArgs, { stdio: 'inherit' });
  }
}
