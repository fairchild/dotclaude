import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    poolOptions: {
      workers: {
        main: "./runtime/index.ts",
        singleWorker: true,
        miniflare: {
          compatibilityDate: "2026-05-01",
          compatibilityFlags: ["nodejs_compat"],
          bindings: {
            ANTHROPIC_ENVIRONMENT_ID: "env_test",
            ANTHROPIC_ENVIRONMENT_KEY: "test-environment-key",
            ANTHROPIC_WEBHOOK_SIGNING_KEY:
              // base64-encoded test secret for standardwebhooks (raw bytes "test-webhook-signing-key-bytes-32")
              "whsec_dGVzdC13ZWJob29rLXNpZ25pbmcta2V5LWJ5dGVzLTMy",
            ANTHROPIC_API_BASE: "https://anthropic.test.invalid",
            ANTHROPIC_BETA_HEADER: "managed-agents-2026-04-01",
            EMAIL_DOMAIN: "example.com",
          },
          kvNamespaces: ["SECRETS", "EGRESS_POLICIES", "AGENT_INBOX"],
        },
      },
    },
  },
});
