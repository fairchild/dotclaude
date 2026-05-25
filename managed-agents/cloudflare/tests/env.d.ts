import type { Env } from "../runtime/env.d.ts";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
