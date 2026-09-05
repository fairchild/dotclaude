import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { installPrompt, renderMarkdown, renderSkillPage } from "../worker/skill-page.ts";

const template = readFileSync(join(import.meta.dir, "../worker/skill.html"), "utf8");
describe("skill reading and installation", () => {
  test("rejects unsafe skill names before generating install commands", () => {
    for (const name of ['$(touch injected)', '`touch injected`', 'name"; touch injected; "', "$HOME", "../outside", "nested/name", "a\\b", "name\n", "name\r", "name with spaces", "--checkpoint", "a--b", "trailing-", "", "Uppercase"]) {
      expect(() => installPrompt(name, "# Example\n", ["SKILL.md"])).toThrow("unsafe skill name");
    }
    for (const name of ["cmux-orchestrator", "skill-v2", "a", "123"]) {
      expect(installPrompt(name, "# Example\n", ["SKILL.md"])).toContain(`.agents/skills/${name}`);
    }
  });
  test("hosted build rejects unsafe names before copying resources or creating archives", () => {
    const root = mkdtempSync(join(tmpdir(), "unsafe-skill-"));
    try {
      const name = "$(touch injected)";
      const skillDir = join(root, "skills", name);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${JSON.stringify(name)}\ndescription: Test skill\n---\n# Example\n`);
      const build = spawnSync("bun", [join(import.meta.dir, "../worker/build.ts"), "--root", join(root, "skills"), "--out", join(root, "dist")], { encoding: "utf8" });
      expect(build.status).not.toBe(0);
      expect(build.stderr).toContain("unsafe skill name");
      expect(existsSync(join(root, "dist/public/skills", name))).toBe(false);
      expect(existsSync(join(root, "dist/public/downloads", name))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("renders headings, code, tables and relative resource links without active HTML", () => {
    const rendered = renderMarkdown('# Read\n\n`a < b`\n\n```sh\ncat < input\n```\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n[Guide](references/guide.md)\n\n| A | B |\n| - | - |\n| 1 | 2 |', 'example');
    expect(rendered).toContain('<h2 id="read">Read</h2>');
    expect(rendered).toContain('<code>a &lt; b</code>');
    expect(rendered).toContain('cat &lt; input');
    expect(rendered).toContain('<table>');
    expect(rendered).toContain('https://skills.cloudcompute.com/skills/example/references/guide.md');
    expect(rendered).not.toContain('<script>');
    expect(rendered).not.toContain('href="javascript:');
    expect(rendered).not.toContain('&amp;lt;');
  });
  test("escapes page metadata and inline prompt without replacing skill placeholders", () => {
    const page = renderSkillPage(template, 'example', '\"><img src=x onerror=alert(1)>', '---\nname: example\n---\n\n</textarea><script>bad()</script>\n{{NAME}}\n', ['SKILL.md', 'references/guide.md']);
    expect(page).not.toContain('<img src=x');
    expect(page).not.toContain('<script>bad()');
    expect(page).toContain('&lt;/textarea&gt;');
    expect(page).toContain('{{NAME}}');
    expect(page).toContain('2 files');
  });
  test("prompt lists archive and every supporting path before the inline skill", () => {
    const markdown = "# Example\n";
    const prompt = installPrompt("example", markdown, ["SKILL.md", "scripts/install.sh", "references/a guide.md", "assets/logo.bin"]);
    expect(prompt).toContain("https://skills.cloudcompute.com/downloads/example/skill.tgz");
    for (const path of ["scripts/install.sh", "references/a guide.md", "assets/logo.bin"]) {
      expect(prompt).toContain(`- ${path}`);
      expect(prompt.indexOf(`- ${path}`)).toBeLessThan(prompt.indexOf(markdown));
    }
    expect(prompt.split("https://skills.cloudcompute.com/skills/example/")).toHaveLength(2);
    expect(prompt).toContain("URL-encode each path segment when fetching.");
    expect(prompt).not.toContain("- example/");
    expect(prompt).not.toContain("https://skills.cloudcompute.com/skills/example/references/");
    expect(installPrompt("example", markdown, ["SKILL.md"])).toContain("No supporting files.");
  });
  for (const ending of ['\n', '']) {
    test(`copied shell command installs exact bytes ${ending ? 'with' : 'without'} final newline`, () => {
      const root = mkdtempSync(join(tmpdir(), 'skill-install-'));
      try {
        const markdown = '---\nname: example\n---\n\n# Example\n\n$HOME `echo nope` $(echo nope) "quotes" & <tags>' + ending;
        const prompt = installPrompt('example', markdown, ['SKILL.md']);
        expect(prompt).toContain('https://skills.cloudcompute.com/manifest.json');
        expect(prompt).toContain('SHA-256');
        // Substitute only the destination; never change the process HOME.
        const command = prompt.split('Run this command to install SKILL.md:\n\n')[1]!.replaceAll('"$HOME/.agents/skills/example', `"${root}/example`);
        const result = spawnSync('sh', ['-c', command], { encoding: 'utf8' });
        expect(result.status).toBe(0);
        expect(readFileSync(join(root, 'example/SKILL.md'), 'utf8')).toBe(markdown);
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  }
});
