// How mint-jit.sh picks its credential and handles the live config, against a gh and a curl on PATH
// that answer from a script. Nothing here reaches GitHub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;

function world({ gh = "", curl = "", appConfig = false }) {
  const dir = mkdtempSync(join(tmpdir(), "mint-jit-test-"));
  for (const [name, body] of Object.entries({ gh, curl })) {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\necho "${name} $*" >> "${dir}/calls"\ncat > /dev/null\n${body}`);
    chmodSync(join(dir, name), 0o755);
  }
  const config = join(dir, "config");
  if (appConfig) {
    const key = join(dir, "key.pem");
    spawnSync("openssl", ["genrsa", "-out", key, "2048"], { stdio: "ignore" });
    writeFileSync(config, `GITHUB_APP_ID=1\nGITHUB_APP_INSTALLATION_ID=2\nGITHUB_APP_PRIVATE_KEY_PATH=${key}\n`);
  }
  const out = join(dir, "jit");
  const run = spawnSync("bash", [`${HERE}mint-jit.sh`, "acme/widgets", "pr-7", out, "self-hosted,optin,pr-7"], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GONDOLIN_APP_CONFIG: config },
    encoding: "utf8",
    input: "",
  });
  return { ...run, out, calls: existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8") : "" };
}

test("with no App configured, the operator's gh login mints, and the config is theirs alone", () => {
  const { status, stdout, out, calls } = world({ gh: `echo '{"encoded_jit_config":"abc"}'` });
  assert.equal(status, 0);
  assert.equal(stdout.trim(), "gondolin-pr-7");
  assert.equal(readFileSync(out, "utf8"), "abc");
  assert.equal(statSync(out).mode & 0o777, 0o600);
  assert.match(calls, /gh api -X POST repos\/acme\/widgets\/actions\/runners\/generate-jitconfig/);
});

test("with an App configured, the App mints and gh is not asked", () => {
  const curl = `case "$*" in
  *access_tokens*) echo '{"token":"installation"}' ;;
  *generate-jitconfig*) echo '{"encoded_jit_config":"def"}' ;;
esac`;
  const { status, out, calls } = world({ curl, appConfig: true });
  assert.equal(status, 0);
  assert.equal(readFileSync(out, "utf8"), "def");
  assert.doesNotMatch(calls, /^gh /m);
  assert.doesNotMatch(calls, /Bearer/, "a token on curl's arguments is visible to every account");
  assert.match(calls, /"repositories":\["widgets"\]/, "the token covers this repository alone");
});

test("GitHub's refusal is reported in its own words, and no config is left behind", () => {
  const { status, stderr, out } = world({ gh: `echo '{"message":"Resource not accessible by integration"}'; exit 1` });
  assert.equal(status, 1);
  assert.match(stderr, /Resource not accessible by integration/);
  assert.equal(existsSync(out), false);
});
