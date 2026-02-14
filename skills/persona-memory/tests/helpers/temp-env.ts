import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export interface IsolatedTestEnv {
  root: string;
  home: string;
  memoryHome: string;
  binDir: string;
  env: Record<string, string>;
  cleanup: () => void;
}

export function createIsolatedTestEnv(prefix = "persona-memory-test-"): IsolatedTestEnv {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const home = join(root, "home");
  const memoryHome = join(root, "memory");
  const binDir = join(root, "bin");

  mkdirSync(home, { recursive: true });
  mkdirSync(memoryHome, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    HOME: home,
    AI_MEMORY_HOME: memoryHome,
    AI_MEMORY_PROFILE: "default",
    AI_MEMORY_NOW: "2026-02-13T00:00:00.000Z",
  };

  return {
    root,
    home,
    memoryHome,
    binDir,
    env,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
