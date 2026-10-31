import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCap, createSanitizer, sanitize } from "./terminal.mjs";

const ESC = "\x1b";

test("text, newlines and tabs pass through", () => {
  assert.equal(sanitize("ok\tdone\nnext é ✓"), "ok\tdone\nnext é ✓");
});

test("SGR colour survives", () => {
  assert.equal(sanitize(`${ESC}[32m✓${ESC}[0m`), `${ESC}[32m✓${ESC}[0m`);
});

test("conceal is dropped, and an 8 inside an extended colour is not mistaken for it", () => {
  assert.equal(sanitize(`a${ESC}[8mhidden${ESC}[0m`), `ahidden${ESC}[0m`);
  assert.equal(sanitize(`${ESC}[1;8m!`), "!");
  assert.equal(sanitize(`${ESC}[38;5;8m.`), `${ESC}[38;5;8m.`);
  assert.equal(sanitize(`${ESC}[48;2;8;8;8m.`), `${ESC}[48;2;8;8;8m.`);
});

test("an OSC 52 clipboard write loses its escape and terminator", () => {
  const out = sanitize(`before${ESC}]52;c;cm0gLXJmIH4=\x07after`);
  assert.ok(!out.includes(ESC) && !out.includes("\x07"));
});

test("cursor movement and screen clears are dropped", () => {
  for (const seq of ["[2J", "[H", "[1A", "[?1049h", "P1$qm"]) {
    assert.ok(!sanitize(`${ESC}${seq}x`).includes(ESC), seq);
  }
});

test("a bare carriage return cannot overwrite the line before it", () => {
  assert.equal(sanitize("real\rfake"), "realfake");
  assert.equal(sanitize("line one\r\nline two"), "line one\nline two");
});

test("C1 controls, DEL and NUL are dropped", () => {
  assert.equal(sanitize("a\u009b2Jb\u0085c\x7fd\x00e"), "a2Jbcde");
});

test("a sequence split across chunks never passes an escape", () => {
  const s = createSanitizer();
  const out = s.write(Buffer.from(`ok${ESC}`)) + s.write(Buffer.from("]52;c;aGk=\x07")) + s.end();
  assert.ok(!out.includes(ESC) && !out.includes("\x07"));
});

test("a UTF-8 character split across chunks is reassembled", () => {
  const bytes = Buffer.from("é");
  const s = createSanitizer();
  assert.equal(s.write(bytes.subarray(0, 1)) + s.write(bytes.subarray(1)) + s.end(), "é");
});

const script = fileURLToPath(new URL("./terminal.mjs", import.meta.url));

test("as a filter it sanitises stdin", () => {
  const run = spawnSync(process.execPath, [script], { input: `x${ESC}]52;c;aGk=\x07y\n` });
  assert.equal(run.status, 0);
  assert.equal(run.stdout.toString(), "x]52;c;aGk=y\n");
});

test("as a filter it still runs when reached through a symlink", () => {
  const link = join(mkdtempSync(join(tmpdir(), "terminal-")), "terminal.mjs");
  symlinkSync(script, link);
  const run = spawnSync(process.execPath, [link], { input: "through a link\n" });
  assert.equal(run.stdout.toString(), "through a link\n");
});

test("guest output past the cap is dropped, with one line saying so", () => {
  const written = [];
  const cap = createCap((text) => written.push(text), 1024 * 1024);
  const chunk = "x".repeat(4095) + "\n";
  for (let i = 0; i < 10_000; i++) cap(chunk);

  const bytes = written.reduce((sum, text) => sum + Buffer.byteLength(text), 0);
  assert.ok(bytes <= 1024 * 1024 + 100, `${bytes} bytes written for a 1 MiB cap`);
  assert.equal(written.at(-1), "\n[guest output past 1048576 bytes dropped]\n");
  assert.equal(written.filter((text) => text.includes("dropped")).length, 1);
});
