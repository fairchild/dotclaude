import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const FIXTURE_ROOT = join(import.meta.dir, "..", "fixtures");

export function fixturePath(...parts: string[]): string {
  return join(FIXTURE_ROOT, ...parts);
}

export function readFixture(...parts: string[]): string {
  return readFileSync(fixturePath(...parts), "utf-8");
}

export function writeFixture(contents: string, ...parts: string[]): void {
  const target = fixturePath(...parts);
  const dir = dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(target, contents, "utf-8");
}
