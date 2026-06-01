/**
 * Resolve ${ref:name} placeholders in a header value template against the
 * SECRETS KV namespace. Returns null if any referenced secret is missing -
 * the caller should fail closed rather than send a partially-substituted
 * header.
 */
import type { Env } from "../env.d.ts";
import { resolveSecret } from "./store.ts";

const REF_PATTERN = /\$\{ref:([a-zA-Z0-9_-]+)\}/g;

export async function resolveTemplate(env: Env, template: string): Promise<string | null> {
  const refs = [...template.matchAll(REF_PATTERN)].map((m) => m[1]!);
  if (refs.length === 0) return template;

  const values = await Promise.all(refs.map((name) => resolveSecret(env, name)));
  const lookup = new Map<string, string>();
  for (let i = 0; i < refs.length; i++) {
    const v = values[i];
    if (v == null) return null;
    lookup.set(refs[i]!, v);
  }

  return template.replace(REF_PATTERN, (_, name: string) => lookup.get(name)!);
}
