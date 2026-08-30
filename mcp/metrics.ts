#!/usr/bin/env bun
/**
 * Query the hosted skills server's usage from Analytics Engine.
 *
 * Every request the worker serves writes one datapoint to the
 * `skills_mcp_usage` dataset: blob1..7 = method, skill, outcome,
 * client-label, user-agent, country, colo; double1 = latency ms,
 * double2 = response bytes. This script reads it back over the Analytics
 * Engine SQL API.
 *
 * Needs:
 *   CLOUDFLARE_ACCOUNT_ID  — `bunx wrangler whoami` prints it
 *   CLOUDFLARE_API_TOKEN   — API token with Account Analytics : Read
 *                            (dash.cloudflare.com → My Profile → API Tokens)
 *
 * Usage:
 *   bun metrics.ts                 # last 24h summary
 *   bun metrics.ts --hours 168     # last week
 *   bun metrics.ts --sql "SELECT ..."   # raw SQL against the dataset
 */
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    hours: { type: "string", default: "24" },
    sql: { type: "string" },
  },
});

function dotenvFallback(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const home = `${process.env.HOME}/.claude/.env`;  // portability: allow — the consumer's own gitignored env file
    const line = require("node:fs").readFileSync(home, "utf-8").split("\n")
      .find((l: string) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

const account = dotenvFallback("CLOUDFLARE_ACCOUNT_ID");
const token = dotenvFallback("CLOUDFLARE_API_TOKEN");
if (!account || !token) {
  console.error("set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Account Analytics : Read), in the environment or ~/.claude/.env — see the header of this script");
  process.exit(2);
}

async function query(sql: string): Promise<{ data: Record<string, unknown>[] }> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: sql,
  });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return response.json() as Promise<{ data: Record<string, unknown>[] }>;
}

function show(title: string, rows: Record<string, unknown>[]): void {
  console.log(`\n## ${title}`);
  if (!rows.length) return console.log("(no data)");
  const keys = Object.keys(rows[0]!);
  const widths = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k]).length)));
  console.log(keys.map((k, i) => k.padEnd(widths[i]!)).join("  "));
  for (const row of rows) console.log(keys.map((k, i) => String(row[k]).padEnd(widths[i]!)).join("  "));
}

const since = `timestamp > NOW() - INTERVAL '${Number(values.hours)}' HOUR`;

if (values.sql) {
  show("raw query", (await query(values.sql)).data);
  process.exit(0);
}

show(`by method (last ${values.hours}h)`, (await query(`
  SELECT blob1 AS method, blob3 AS outcome,
         SUM(_sample_interval) AS requests,
         ROUND(AVG(double1), 1) AS avg_ms,
         ROUND(MAX(double1), 1) AS max_ms
  FROM skills_mcp_usage WHERE ${since}
  GROUP BY method, outcome ORDER BY requests DESC LIMIT 20`)).data);

show("by client", (await query(`
  SELECT IF(blob4 = '', '(unlabeled)', blob4) AS client, blob6 AS country,
         SUM(_sample_interval) AS requests
  FROM skills_mcp_usage WHERE ${since}
  GROUP BY client, country ORDER BY requests DESC LIMIT 20`)).data);

show("top skills read", (await query(`
  SELECT blob2 AS skill, SUM(_sample_interval) AS requests
  FROM skills_mcp_usage WHERE ${since} AND blob2 != ''
  GROUP BY skill ORDER BY requests DESC LIMIT 15`)).data);

show("user agents", (await query(`
  SELECT blob5 AS user_agent, SUM(_sample_interval) AS requests
  FROM skills_mcp_usage WHERE ${since}
  GROUP BY user_agent ORDER BY requests DESC LIMIT 10`)).data);
