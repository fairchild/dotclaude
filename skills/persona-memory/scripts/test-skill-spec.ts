#!/usr/bin/env bun
import { existsSync, readFileSync, statSync } from "fs";
import { basename, join } from "path";

interface CliOptions {
  report: "text" | "json";
  full: boolean;
  skillDir: string;
  requireMetadataStatus: boolean;
}

interface CheckResult {
  name: string;
  ok: boolean;
  details: string;
}

interface ScriptReport {
  ok: boolean;
  code: string;
  details: {
    skill_dir: string;
    checks: CheckResult[];
    summary: {
      passed: number;
      failed: number;
      total: number;
    };
  };
}

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseOptions(): CliOptions {
  const reportRaw = getArg("report");
  const report = reportRaw === "json" ? "json" : "text";
  const full = hasFlag("full");
  const skillDir = getArg("skill-dir") || join(import.meta.dir, "..");
  const requireMetadataStatus = hasFlag("require-metadata-status");
  return {
    report,
    full,
    skillDir,
    requireMetadataStatus,
  };
}

function runCommand(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string; exitCode: number } {
  const child = Bun.spawnSync(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    ok: child.exitCode === 0,
    stdout: Buffer.from(child.stdout).toString("utf-8").trim(),
    stderr: Buffer.from(child.stderr).toString("utf-8").trim(),
    exitCode: child.exitCode,
  };
}

function parseSkillFrontmatter(content: string): Record<string, unknown> {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    throw new Error("SKILL.md must start with YAML frontmatter delimiter ---");
  }
  const endIdx = lines.findIndex((line, idx) => idx > 0 && line.trim() === "---");
  if (endIdx < 0) {
    throw new Error("SKILL.md frontmatter closing delimiter --- is missing");
  }

  const map: Record<string, unknown> = {};
  let nestedKey: string | null = null;
  for (const line of lines.slice(1, endIdx)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const topMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (topMatch) {
      const [, key, rawValue] = topMatch;
      const value = rawValue.trim();
      if (value.length === 0) {
        map[key] = {};
        nestedKey = key;
      } else {
        map[key] = value;
        nestedKey = null;
      }
      continue;
    }

    const nestedMatch = line.match(/^\s{2}([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (nestedMatch) {
      if (!nestedKey || typeof map[nestedKey] !== "object" || map[nestedKey] === null) {
        throw new Error(`Unexpected nested key without parent: '${line.trim()}'`);
      }
      const [, key, rawValue] = nestedMatch;
      (map[nestedKey] as Record<string, unknown>)[key] = rawValue.trim();
      continue;
    }

    throw new Error(`Invalid frontmatter line: '${line.trim()}'`);
  }

  return map;
}

function isExecutable(path: string): boolean {
  const mode = statSync(path).mode;
  return (mode & 0o111) !== 0;
}

function addCheck(checks: CheckResult[], name: string, ok: boolean, details: string): void {
  checks.push({ name, ok, details });
}

function mustExist(checks: CheckResult[], name: string, path: string): void {
  const ok = existsSync(path);
  addCheck(checks, name, ok, ok ? path : `Missing: ${path}`);
}

function requiredSkillFiles(skillDir: string): { path: string; executable?: boolean }[] {
  return [
    { path: join(skillDir, "SKILL.md") },
    { path: join(skillDir, "scripts", "bootstrap.ts"), executable: true },
    { path: join(skillDir, "scripts", "remember.ts"), executable: true },
    { path: join(skillDir, "scripts", "recall.ts"), executable: true },
    { path: join(skillDir, "scripts", "consolidate.ts"), executable: true },
    { path: join(skillDir, "scripts", "session-start.ts"), executable: true },
    { path: join(skillDir, "scripts", "session-end.ts"), executable: true },
    { path: join(skillDir, "scripts", "launch-claude.sh"), executable: true },
    { path: join(skillDir, "references", "memory-schema.md") },
    { path: join(skillDir, "references", "personality-contract.md") },
    { path: join(skillDir, "references", "scoring-and-promotion.md") },
    { path: join(skillDir, "references", "hook-setup.md") },
    { path: join(skillDir, "references", "TESTING.md") },
  ];
}

function validateFrontmatter(checks: CheckResult[], skillDir: string, requireMetadataStatus: boolean): void {
  const skillPath = join(skillDir, "SKILL.md");
  const content = readFileSync(skillPath, "utf-8");
  try {
    const fm = parseSkillFrontmatter(content);
    const keys = Object.keys(fm).sort();
    const allowed = ["description", "metadata", "name"];
    const keyMatch = keys.every((key) => allowed.includes(key)) && keys.includes("name") && keys.includes("description");
    addCheck(
      checks,
      "frontmatter keys",
      keyMatch,
      keyMatch
        ? `keys=${keys.join(",")}`
        : `Expected name,description (+ optional metadata); got ${keys.join(",") || "(none)"}`,
    );

    const hasName = typeof fm.name === "string" && fm.name.trim().length > 0;
    addCheck(checks, "frontmatter name", hasName, hasName ? fm.name : "name missing/empty");

    const hasDescription = typeof fm.description === "string" && fm.description.trim().length > 0;
    addCheck(
      checks,
      "frontmatter description",
      hasDescription,
      hasDescription ? "description present" : "description missing/empty",
    );

    const expectedName = basename(skillDir);
    const nameMatchesDir = fm.name === expectedName;
    addCheck(
      checks,
      "skill name matches directory",
      nameMatchesDir,
      nameMatchesDir ? `name=${fm.name}` : `name=${fm.name} dir=${expectedName}`,
    );

    if (Object.prototype.hasOwnProperty.call(fm, "metadata")) {
      const metadata = fm.metadata as Record<string, unknown>;
      const hasStatus = metadata && typeof metadata.status === "string" && metadata.status.trim().length > 0;
      addCheck(
        checks,
        "frontmatter metadata.status (optional)",
        hasStatus,
        hasStatus ? `status=${metadata.status}` : "metadata.status missing/empty",
      );
    } else {
      addCheck(
        checks,
        "frontmatter metadata.status (optional)",
        !requireMetadataStatus,
        requireMetadataStatus ? "metadata.status missing" : "metadata.status not set (allowed)",
      );
    }
  } catch (err) {
    addCheck(
      checks,
      "frontmatter parse",
      false,
      err instanceof Error ? err.message : String(err),
    );
  }
}

function validateReferencesLinked(checks: CheckResult[], skillDir: string): void {
  const skillPath = join(skillDir, "SKILL.md");
  const content = readFileSync(skillPath, "utf-8");
  const refMatches = Array.from(content.matchAll(/`(references\/[^`]+)`/g)).map((m) => m[1]);
  const uniqueRefs = Array.from(new Set(refMatches));

  if (uniqueRefs.length === 0) {
    addCheck(checks, "references listed in SKILL.md", false, "No `references/...` links found");
    return;
  }

  const missing = uniqueRefs
    .map((rel) => ({ rel, abs: join(skillDir, rel) }))
    .filter((item) => !existsSync(item.abs));

  addCheck(
    checks,
    "references listed in SKILL.md",
    missing.length === 0,
    missing.length === 0
      ? `${uniqueRefs.length} reference links valid`
      : `Missing: ${missing.map((item) => item.rel).join(", ")}`,
  );
}

function validatePackageScripts(checks: CheckResult[], skillDir: string): void {
  const packagePath = join(skillDir, "package.json");
  if (!existsSync(packagePath)) {
    addCheck(checks, "package.json exists", false, packagePath);
    return;
  }
  addCheck(checks, "package.json exists", true, packagePath);

  try {
    const pkg = JSON.parse(readFileSync(packagePath, "utf-8")) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts || {};
    const required = [
      "test",
      "test:deterministic",
      "test:skill-spec",
      "test:skill-spec:full",
      "evalset:rebuild",
      "dashboard:serve",
      "dashboard:capture",
    ];
    const missing = required.filter((key) => !scripts[key]);
    addCheck(
      checks,
      "required npm scripts",
      missing.length === 0,
      missing.length === 0 ? required.join(", ") : `Missing scripts: ${missing.join(", ")}`,
    );
  } catch (err) {
    addCheck(
      checks,
      "package.json parse",
      false,
      err instanceof Error ? err.message : String(err),
    );
  }
}

function runRuntimeChecks(checks: CheckResult[], skillDir: string): void {
  const rebuild = runCommand(skillDir, ["bun", "scripts/evalset-rebuild.ts", "--report", "json"]);
  addCheck(
    checks,
    "runtime evalset rebuild",
    rebuild.ok,
    rebuild.ok ? "ok" : `exit=${rebuild.exitCode} ${rebuild.stderr || rebuild.stdout}`,
  );

  const deterministic = runCommand(skillDir, ["bun", "tests/harness.ts", "--suite", "deterministic", "--report", "text"]);
  addCheck(
    checks,
    "runtime deterministic harness",
    deterministic.ok,
    deterministic.ok ? "ok" : `exit=${deterministic.exitCode} ${deterministic.stderr || deterministic.stdout}`,
  );
}

function main(): void {
  const opts = parseOptions();
  const checks: CheckResult[] = [];

  const files = requiredSkillFiles(opts.skillDir);
  for (const file of files) {
    mustExist(checks, `file exists: ${file.path.replace(`${opts.skillDir}/`, "")}`, file.path);
    if (file.executable && existsSync(file.path)) {
      const ok = isExecutable(file.path);
      addCheck(
        checks,
        `file executable: ${file.path.replace(`${opts.skillDir}/`, "")}`,
        ok,
        ok ? "mode includes execute bit" : "execute bit is missing",
      );
    }
  }

  if (existsSync(join(opts.skillDir, "SKILL.md"))) {
    validateFrontmatter(checks, opts.skillDir, opts.requireMetadataStatus);
    validateReferencesLinked(checks, opts.skillDir);
  }

  validatePackageScripts(checks, opts.skillDir);

  if (opts.full) {
    runRuntimeChecks(checks, opts.skillDir);
  }

  const failed = checks.filter((check) => !check.ok).length;
  const report: ScriptReport = {
    ok: failed === 0,
    code: failed === 0 ? "SUCCESS" : "VALIDATION_ERROR",
    details: {
      skill_dir: opts.skillDir,
      checks,
      summary: {
        passed: checks.length - failed,
        failed,
        total: checks.length,
      },
    },
  };

  if (opts.report === "json") {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }

  for (const check of checks) {
    const prefix = check.ok ? "[pass]" : "[fail]";
    console.log(`${prefix} ${check.name} :: ${check.details}`);
  }
  console.log(
    `[summary] passed=${report.details.summary.passed} failed=${report.details.summary.failed} total=${report.details.summary.total}`,
  );
  process.exit(report.ok ? 0 : 1);
}

main();
