/**
 * Outbound fetch interceptor for tool calls. Every fetch tools make goes
 * through here: look up policies, apply the first matching action (currently
 * just inject_header), then forward to global fetch.
 *
 * The agent never sees the secret value - it only writes ${ref:name} into
 * its tool call inputs (or just calls a host that has a policy attached, and
 * the header arrives automatically).
 */
import type { Env } from "../env.d.ts";
import { log } from "../helpers.ts";
import { matchPolicy } from "./match.ts";
import { resolveTemplate } from "./resolve.ts";
import { listPolicies } from "./store.ts";

export async function runEgressFetch(
  env: Env,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const req = new Request(input, init);
  const url = new URL(req.url);

  const policies = await listPolicies(env);
  const policy = matchPolicy(url, policies);

  if (!policy) {
    log("info", "egress.no_policy", { host: url.host });
    return fetch(req);
  }

  const headers = new Headers(req.headers);
  if (policy.action.type === "inject_header") {
    const value = await resolveTemplate(env, policy.action.value_template);
    if (value === null) {
      log("warn", "egress.unresolved_secret", { policyId: policy.id });
      return new Response("egress: required secret missing", { status: 502 });
    }
    headers.set(policy.action.header, value);
    log("info", "egress.injected", { host: url.host, header: policy.action.header });
  }

  return fetch(
    new Request(req.url, {
      method: req.method,
      headers,
      body: req.body,
      redirect: req.redirect,
    }),
  );
}
