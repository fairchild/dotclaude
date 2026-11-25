/** A release version has its own changelog entry, and every entry heading has a link. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const changelog = readFileSync(join(import.meta.dir, "..", "CHANGELOG.md"), "utf8");
const { version } = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"));

test("the package version has a dated entry and Unreleased sits on top", () => {
  const headings = [...changelog.matchAll(/^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?$/gm)].map(m => ({ name: m[1]!, date: m[2] }));
  expect(headings[0]?.name).toBe("Unreleased");
  expect(headings.find(h => h.name === version)?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  for (const { name } of headings) expect(changelog).toContain(`\n[${name}]: https://`);
});
