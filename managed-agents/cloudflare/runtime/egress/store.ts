/**
 * KV-backed read access to egress policies and secrets.
 *
 * Layout:
 *   EGRESS_POLICIES/policy:<id>           policy JSON
 *   EGRESS_POLICIES/policies:index        JSON array of policy ids
 *   SECRETS/<reference_name>              raw secret value (string)
 *
 * Writes are out of scope for V1 - configure policies and secrets via
 * `wrangler kv key put` or the Cloudflare dashboard.
 */
import type { Env } from "../env.d.ts";
import type { EgressPolicy } from "./types.ts";

const POLICY_KEY = (id: string): string => `policy:${id}`;
const INDEX_KEY = "policies:index";

export async function listPolicies(env: Env): Promise<EgressPolicy[]> {
  const indexRaw = await env.EGRESS_POLICIES.get(INDEX_KEY);
  if (!indexRaw) return [];
  const ids = JSON.parse(indexRaw) as string[];
  const policies = await Promise.all(ids.map((id) => loadPolicy(env, id)));
  return policies.filter((p): p is EgressPolicy => p !== null);
}

export async function loadPolicy(env: Env, id: string): Promise<EgressPolicy | null> {
  const raw = await env.EGRESS_POLICIES.get(POLICY_KEY(id));
  if (!raw) return null;
  return JSON.parse(raw) as EgressPolicy;
}

export async function resolveSecret(env: Env, referenceName: string): Promise<string | null> {
  return env.SECRETS.get(referenceName);
}
