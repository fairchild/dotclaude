#!/usr/bin/env bun
import { existsSync, readFileSync, statSync } from "fs";
import { extname, join, relative } from "path";
import {
  appendLabel,
  compileEvalset,
  ensureEvalsetInitialized,
  getEvalsetRows,
  getEvalsetStats,
  updateBaseRow,
  type BaseRowEditInput,
  type LabelInput,
} from "./evalset-lib.ts";

type RunKind = "eval" | "live" | "deterministic";

interface ApiEnvelope {
  ok: boolean;
  code: string;
  details?: Record<string, unknown>;
}

interface RunResult {
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  parsedReport: Record<string, unknown> | null;
}

interface RunPlan {
  kind: RunKind;
  endpoint: string;
  script: string;
  args: string[];
  envOverrides: Record<string, string>;
  artifacts: string[];
  networkDependency: "none" | "anthropic";
  preconditions: string[];
}

const skillDir = join(import.meta.dir, "..");
const dashboardDir = join(skillDir, "assets", "eval-dashboard");
const artifactsDir = join(skillDir, "tests", ".artifacts");
const evalFixturesDir = join(skillDir, "tests", "fixtures", "eval");
const homeDir = process.env.HOME || "";

interface SecretResolution {
  value: string | null;
  source: string;
}

function normalizeKind(value: string | null): "events" | "queries" | null {
  if (value === "events" || value === "queries") return value;
  return null;
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object") return {};
    return body;
  } catch {
    return {};
  }
}

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

function parsePort(raw: string | null): number {
  if (!raw) return 8787;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid --port '${raw}'. Expected an integer between 1 and 65535.`);
  }
  return value;
}

function toJson(status: number, body: ApiEnvelope): Response {
  return new Response(JSON.stringify(body, null, 2) + "\n", {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function mimeType(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".txt" || ext === ".md") return "text/plain; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

function safeResolve(baseDir: string, pathname: string): string | null {
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  const resolved = join(baseDir, relativePath);
  const rel = relative(baseDir, resolved);
  if (rel.startsWith("..") || rel.includes("/../") || rel.includes("\\..\\")) {
    return null;
  }
  return resolved;
}

function serveFile(path: string): Response {
  if (!existsSync(path)) {
    return toJson(404, { ok: false, code: "NOT_FOUND", details: { path } });
  }

  const stat = statSync(path);
  if (!stat.isFile()) {
    return toJson(404, { ok: false, code: "NOT_FOUND", details: { path } });
  }

  return new Response(Bun.file(path), {
    status: 200,
    headers: {
      "content-type": mimeType(path),
      "cache-control": "no-store",
    },
  });
}

function parseAssignmentFile(path: string, targetKey: string): string | null {
  if (!path || !existsSync(path)) return null;

  let raw = "";
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return null;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rhs] = match;
    if (key !== targetKey) continue;

    const valueRaw = rhs.trim();
    if (!valueRaw) return "";

    if (valueRaw.startsWith('"') && valueRaw.endsWith('"') && valueRaw.length >= 2) {
      return valueRaw.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n");
    }
    if (valueRaw.startsWith("'") && valueRaw.endsWith("'") && valueRaw.length >= 2) {
      return valueRaw.slice(1, -1);
    }
    const hashIndex = valueRaw.indexOf(" #");
    if (hashIndex >= 0) return valueRaw.slice(0, hashIndex).trim();
    return valueRaw;
  }

  return null;
}

function resolveAnthropicApiKey(): SecretResolution {
  const envValue = process.env.ANTHROPIC_API_KEY?.trim();
  if (envValue) {
    return { value: envValue, source: "process.env" };
  }

  const candidates = [
    join(homeDir, ".env"),
    join(homeDir, ".zprofile"),
  ];
  for (const path of candidates) {
    const value = parseAssignmentFile(path, "ANTHROPIC_API_KEY")?.trim();
    if (value) {
      return { value, source: path };
    }
  }

  return { value: null, source: "not-found" };
}

const anthropicKey = resolveAnthropicApiKey();

try {
  ensureEvalsetInitialized();
} catch (err) {
  console.error(`[dashboard-server] evalset init failed: ${err instanceof Error ? err.message : String(err)}`);
}

function getStringEnv(overrides: Record<string, string>): Record<string, string> {
  const base = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  if (!base.ANTHROPIC_API_KEY && anthropicKey.value) {
    base.ANTHROPIC_API_KEY = anthropicKey.value;
  }
  return {
    ...base,
    ...overrides,
  };
}

async function runScript(script: string, args: string[], envOverrides: Record<string, string>): Promise<RunResult> {
  const started = Date.now();
  const child = Bun.spawn(["bun", script, ...args], {
    cwd: skillDir,
    env: getStringEnv(envOverrides),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    child.stdout ? new Response(child.stdout).text() : Promise.resolve(""),
    child.stderr ? new Response(child.stderr).text() : Promise.resolve(""),
    child.exited,
  ]);

  let parsedReport: Record<string, unknown> | null = null;
  try {
    parsedReport = JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch {}

  return {
    exitCode,
    durationMs: Date.now() - started,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    parsedReport,
  };
}

function buildRunPlan(kind: RunKind): RunPlan {
  if (kind === "eval") {
    return {
      kind,
      endpoint: "/api/run/eval",
      script: "tests/eval.ts",
      args: ["--report", "json"],
      envOverrides: {
        AI_MEMORY_TEST_LIVE: "0",
      },
      artifacts: ["tests/.artifacts/eval-report.json"],
      networkDependency: "none",
      preconditions: ["None. Runs fully deterministic synthetic fixtures."],
    };
  }

  if (kind === "deterministic") {
    return {
      kind,
      endpoint: "/api/run/deterministic",
      script: "tests/run-deterministic.ts",
      args: ["--report", "json"],
      envOverrides: {
        AI_MEMORY_TEST_LIVE: "0",
      },
      artifacts: ["tests/.artifacts/eval-report.json"],
      networkDependency: "none",
      preconditions: ["None. Runs deterministic test paths and synthetic eval."],
    };
  }

  return {
    kind,
    endpoint: "/api/run/live",
    script: "tests/run-live.ts",
    args: ["--report", "json"],
    envOverrides: {
      AI_MEMORY_TEST_LIVE: "1",
      AI_MEMORY_TEST_PROVIDER: process.env.AI_MEMORY_TEST_PROVIDER || "anthropic",
    },
    artifacts: ["tests/.artifacts/live-report.json", "tests/.artifacts/live-metrics.jsonl"],
    networkDependency: "anthropic",
    preconditions: [
      "AI_MEMORY_TEST_LIVE=1",
      "AI_MEMORY_TEST_PROVIDER=anthropic (default)",
      "ANTHROPIC_API_KEY must be set or run is skipped",
    ],
  };
}

async function executeRun(plan: RunPlan): Promise<RunResult> {
  return runScript(plan.script, plan.args, plan.envOverrides);
}

function statusFromRun(run: RunResult): "ok" | "warn" | "bad" {
  if (run.exitCode !== 0) return "bad";
  const status = (run.parsedReport?.status as string | undefined) || "";
  if (status === "skipped") return "warn";
  return "ok";
}

const host = getArg("host") || "127.0.0.1";
let port = 8787;
try {
  port = parsePort(getArg("port"));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

let inFlight: Promise<Response> | null = null;

async function handleRun(kind: RunKind): Promise<Response> {
  if (inFlight) {
    return toJson(409, {
      ok: false,
      code: "RUN_IN_PROGRESS",
      details: { message: "Another run is already in progress." },
    });
  }

  inFlight = (async () => {
    const plan = buildRunPlan(kind);
    const run = await executeRun(plan);
    const runStatus = statusFromRun(run);
    const code = runStatus === "bad" ? "RUN_FAILED" : "RUN_COMPLETED";

    return toJson(runStatus === "bad" ? 500 : 200, {
      ok: runStatus !== "bad",
      code,
      details: {
        kind,
        run_status: runStatus,
        duration_ms: run.durationMs,
        exit_code: run.exitCode,
        endpoint: plan.endpoint,
        invocation: {
          command: `bun ${plan.script} ${plan.args.join(" ")}`.trim(),
          script: plan.script,
          args: plan.args,
          network_dependency: plan.networkDependency,
        },
        artifacts: plan.artifacts,
        preconditions: plan.preconditions,
        report: run.parsedReport,
        stderr: run.stderr || null,
      },
    });
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

const server = Bun.serve({
  hostname: host,
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname === "/") {
      return Response.redirect(new URL("/assets/eval-dashboard/", req.url), 302);
    }

    if (pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    if (pathname === "/api/health") {
      return toJson(200, {
        ok: true,
        code: "HEALTHY",
        details: {
          running: inFlight !== null,
          dashboard_dir: dashboardDir,
          artifacts_dir: artifactsDir,
          eval_fixtures_dir: evalFixturesDir,
          anthropic_key_present: Boolean(anthropicKey.value),
          anthropic_key_source: anthropicKey.source,
        },
      });
    }

    if (req.method === "POST" && pathname === "/api/run/eval") {
      return handleRun("eval");
    }

    if (req.method === "POST" && pathname === "/api/run/live") {
      return handleRun("live");
    }

    if (req.method === "POST" && pathname === "/api/run/deterministic") {
      return handleRun("deterministic");
    }

    if (req.method === "GET" && pathname === "/api/evalset/base") {
      const kind = normalizeKind(url.searchParams.get("kind"));
      if (!kind) {
        return toJson(400, { ok: false, code: "VALIDATION_ERROR", details: { message: "kind must be events|queries" } });
      }
      const rows = getEvalsetRows("base", kind);
      return toJson(200, {
        ok: true,
        code: "SUCCESS",
        details: rows as unknown as Record<string, unknown>,
      });
    }

    if (req.method === "GET" && pathname === "/api/evalset/compiled") {
      const kind = normalizeKind(url.searchParams.get("kind"));
      if (!kind) {
        return toJson(400, { ok: false, code: "VALIDATION_ERROR", details: { message: "kind must be events|queries" } });
      }
      const rows = getEvalsetRows("compiled", kind);
      return toJson(200, {
        ok: true,
        code: "SUCCESS",
        details: rows as unknown as Record<string, unknown>,
      });
    }

    if (req.method === "GET" && pathname === "/api/evalset/stats") {
      const stats = getEvalsetStats();
      return toJson(200, {
        ok: true,
        code: "SUCCESS",
        details: stats as unknown as Record<string, unknown>,
      });
    }

    if (req.method === "POST" && pathname === "/api/evalset/rebuild") {
      try {
        const summary = compileEvalset();
        const stats = getEvalsetStats();
        return toJson(200, {
          ok: true,
          code: "SUCCESS",
          details: {
            summary,
            stats,
          },
        });
      } catch (err) {
        return toJson(500, {
          ok: false,
          code: "REBUILD_FAILED",
          details: {
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    if (req.method === "POST" && pathname === "/api/evalset/annotate") {
      const body = await parseJsonBody(req);
      const payload: LabelInput = {
        row_kind: String(body.row_kind || "") as LabelInput["row_kind"],
        row_id: String(body.row_id || ""),
        verdict: String(body.verdict || "") as LabelInput["verdict"],
        rationale: String(body.rationale || ""),
        annotator: body.annotator ? String(body.annotator) : undefined,
        score: body.score as number | undefined,
        correction: body.correction as LabelInput["correction"],
      };

      try {
        const label = appendLabel(payload);
        return toJson(200, {
          ok: true,
          code: "SUCCESS",
          details: {
            label,
          },
        });
      } catch (err) {
        return toJson(400, {
          ok: false,
          code: "VALIDATION_ERROR",
          details: {
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    if (req.method === "POST" && pathname === "/api/evalset/edit") {
      const body = await parseJsonBody(req);
      const payload: BaseRowEditInput = {
        row_kind: String(body.row_kind || "") as BaseRowEditInput["row_kind"],
        row_id: String(body.row_id || ""),
        patch: (body.patch || {}) as BaseRowEditInput["patch"],
      };

      try {
        const row = updateBaseRow(payload);
        return toJson(200, {
          ok: true,
          code: "SUCCESS",
          details: {
            row,
          },
        });
      } catch (err) {
        return toJson(400, {
          ok: false,
          code: "VALIDATION_ERROR",
          details: {
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    if (pathname === "/assets/eval-dashboard") {
      return Response.redirect(new URL("/assets/eval-dashboard/", req.url), 302);
    }

    if (pathname.startsWith("/assets/eval-dashboard/")) {
      const rawPath = pathname.replace("/assets/eval-dashboard/", "");
      const resolved = safeResolve(dashboardDir, rawPath || "index.html");
      if (!resolved) {
        return toJson(400, { ok: false, code: "INVALID_PATH" });
      }
      return serveFile(resolved);
    }

    if (pathname.startsWith("/tests/.artifacts/")) {
      const rawPath = pathname.replace("/tests/.artifacts/", "");
      const resolved = safeResolve(artifactsDir, rawPath);
      if (!resolved) {
        return toJson(400, { ok: false, code: "INVALID_PATH" });
      }
      return serveFile(resolved);
    }

    if (pathname.startsWith("/artifacts/")) {
      const rawPath = pathname.replace("/artifacts/", "");
      const resolved = safeResolve(artifactsDir, rawPath);
      if (!resolved) {
        return toJson(400, { ok: false, code: "INVALID_PATH" });
      }
      return serveFile(resolved);
    }

    if (pathname.startsWith("/fixtures/eval/")) {
      const rawPath = pathname.replace("/fixtures/eval/", "");
      const resolved = safeResolve(evalFixturesDir, rawPath);
      if (!resolved) {
        return toJson(400, { ok: false, code: "INVALID_PATH" });
      }
      return serveFile(resolved);
    }

    if (pathname.startsWith("/tests/fixtures/eval/")) {
      const rawPath = pathname.replace("/tests/fixtures/eval/", "");
      const resolved = safeResolve(evalFixturesDir, rawPath);
      if (!resolved) {
        return toJson(400, { ok: false, code: "INVALID_PATH" });
      }
      return serveFile(resolved);
    }

    return toJson(404, { ok: false, code: "NOT_FOUND", details: { pathname } });
  },
});

console.log(`[dashboard-server] listening on http://${server.hostname}:${server.port}`);
console.log("[dashboard-server] dashboard: /assets/eval-dashboard/");
console.log("[dashboard-server] run eval endpoint: POST /api/run/eval");
console.log("[dashboard-server] run live endpoint: POST /api/run/live");
console.log("[dashboard-server] run deterministic endpoint: POST /api/run/deterministic");
console.log("[dashboard-server] fixtures: /fixtures/eval/");
console.log("[dashboard-server] evalset API: GET /api/evalset/base|compiled?kind=events|queries");
console.log("[dashboard-server] evalset API: GET /api/evalset/stats");
console.log("[dashboard-server] evalset API: POST /api/evalset/annotate");
console.log("[dashboard-server] evalset API: POST /api/evalset/edit");
console.log("[dashboard-server] evalset API: POST /api/evalset/rebuild");
