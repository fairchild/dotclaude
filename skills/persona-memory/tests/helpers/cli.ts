import { join } from "path";

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CliOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
}

const SKILL_DIR = join(import.meta.dir, "..", "..");

export function scriptPath(name: string): string {
  return join(SKILL_DIR, "scripts", name);
}

export function runBunScript(name: string, args: string[] = [], options: CliOptions = {}): CliRunResult {
  const command = ["bun", scriptPath(name), ...args];
  return runCommand(command, options);
}

export function runCommand(command: string[], options: CliOptions = {}): CliRunResult {
  const input = options.stdin ? new TextEncoder().encode(options.stdin) : undefined;

  const proc = Bun.spawnSync(command, {
    cwd: options.cwd,
    env: options.env,
    stdin: input,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout).trim(),
    stderr: new TextDecoder().decode(proc.stderr).trim(),
  };
}
