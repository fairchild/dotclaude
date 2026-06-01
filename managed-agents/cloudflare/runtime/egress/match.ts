/**
 * Match an outbound URL against an egress policy. First match wins.
 * Case-insensitive host comparison; optional path-prefix narrowing.
 */
import type { EgressPolicy } from "./types.ts";

export function matchPolicy(url: URL, policies: EgressPolicy[]): EgressPolicy | null {
  const host = url.host.toLowerCase();
  for (const policy of policies) {
    if (policy.host.toLowerCase() !== host) continue;
    if (policy.path_prefix && !url.pathname.startsWith(policy.path_prefix)) continue;
    return policy;
  }
  return null;
}
