/**
 * Egress policy shapes. Policies live in the EGRESS_POLICIES KV namespace as
 * JSON values; secrets live in SECRETS keyed by reference name. Agent code
 * only ever sees reference names - never the secret values themselves.
 */

export type EgressAction = InjectHeaderAction;

export interface InjectHeaderAction {
  type: "inject_header";
  /** Header name, e.g. "authorization". */
  header: string;
  /**
   * Template for the header value. ${ref:name} placeholders resolve from the
   * SECRETS KV namespace. Example: "Bearer ${ref:stripe}".
   */
  value_template: string;
}

export interface EgressPolicy {
  /** Stable identifier; used as KV key suffix. */
  id: string;
  /** Hostname to match. Case-insensitive, exact match. */
  host: string;
  /** Optional path prefix narrowing the match. */
  path_prefix?: string;
  action: EgressAction;
}
