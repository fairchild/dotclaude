import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { installSafety, packagePrompt, directoryMarkdown, installPrompt, renderMarkdown, renderSkillPage } from "../worker/skill-page.ts";

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
      expect(build.status).toBe(0);
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
  test("the default prompt is a pinned package instruction and the inline version stays available", () => {
    const download = { archive: "/downloads/example/abc.tgz", manifest: "/downloads/example/abc.json", digest: "abc" };
    const prompt = packagePrompt("example", download);
    expect(prompt).toContain("SHA-256: abc");
    expect(prompt).not.toContain("cat >");
    expect(prompt.replace(installSafety, "").length).toBeLessThan(800);
    expect(prompt).toContain(installSafety);
    const inline = installPrompt("example", "# Example\n", ["SKILL.md"]);
    expect(inline).toContain(installSafety);
    expect(inline.indexOf(installSafety)).toBeLessThan(inline.indexOf("# Example"));
    const directory = directoryMarkdown("example", "A useful skill", ["SKILL.md", "references/a guide.md"], download);
    expect(directory).toContain("/skills/example/references/a%20guide.md");
    expect(directory).toContain("## Files");
    expect(directory).toContain(prompt);
    const page = renderSkillPage(template, "example", "A useful skill", "# Example\n", ["SKILL.md"], download);
    expect(page).toContain('id="copy-inline"');
    expect(page).toContain('rel="canonical" href="/skills/example/"');
    expect(page).toContain('rel="alternate" type="text/markdown"');
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

/**
 * Adversarial rendered-HTML snapshot (issue #281).
 *
 * `conformance/fixtures/adversarial.md` is a plain file directly under
 * `fixtures/`, not a `<name>/SKILL.md` directory, so `scanCatalog` (see
 * `core/manifest.ts`) filters it out before it ever reaches `scanSkill` —
 * `readdirSync(...).filter(isDirectory)` runs before any per-entry
 * diagnostic is produced. It never becomes a skill candidate and never
 * emits a `[skills] skipped ...` line, so the other conformance and worker
 * tests that count skills against this same fixtures root are unaffected
 * (verified: `bun test conformance` reports the same 109 pass / 3 skip / 0
 * fail before and after adding the file).
 *
 * The fixture exercises, one section per case:
 *   - a raw HTML block and raw inline HTML tags (html: false must inert them)
 *   - HTML markup inside a heading's own text
 *   - HTML kept inert inside an inline code span and a fenced code block
 *   - a plain `javascript:` link and image, and a plain `data:text/html` link
 *     — markdown-it's own core `validateLink` denylist already refuses these
 *     before this renderer's link/image rules ever run (see BAD_PROTO_RE in
 *     markdown-it's source); the fixture documents that as defense-in-depth
 *   - an `ftp:` link, a `tel:` link, and a `data:image/png;base64,...` image
 *     — none of these are in markdown-it's own denylist, so they reach real
 *     link/image tokens; only this renderer's own href allow-list blocks them
 *   - safe targets that must keep working: mailto:, https:, and relative
 *     sibling links resolved against the skill's base URL, plus an in-page
 *     anchor
 *   - bare autolink-looking text (linkify: false must leave it as plain text)
 *   - reference-style links: an unsafe (javascript:) reference whose
 *     definition markdown-it itself refuses to register, a tel: reference
 *     that registers but is blocked by this renderer's own filter, and a
 *     safe https: reference
 *   - Unicode look-alike scheme tricks: a fullwidth colon (U+FF1A) and a
 *     Cyrillic "а" (U+0430) standing in for the Latin letter in
 *     "javascript:" — both break ASCII scheme parsing, so `new URL(value,
 *     base)` treats them as relative references and resolves them safely
 *     under the skill's own base URL rather than as an absolute javascript:
 *     target (verified against the actual URL() behavior, not assumed)
 *   - a level-6 heading, proving the heading-shift clamp (h+1, max 6) holds
 *     at the boundary instead of overflowing to h7
 */
describe("adversarial rendering snapshot", () => {
  const fixture = readFileSync(join(import.meta.dir, "fixtures/adversarial.md"), "utf8");

  // Attribute-scoped: only flags a protocol inside a real href="..."/src="..."
  // value, never a plain-text mention (the fixture's own prose and code spans
  // legitimately contain the literal strings "javascript:" and "data:").
  const unsafeAttrs = (html: string) => [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)]
    .map((m) => m[1]!)
    .filter((value) => /^(javascript|data|vbscript):/i.test(value));

  // Real live attribute only: a literal (unescaped) "<" starting a tag that
  // carries an on*= attribute. Escaped mentions like "&lt;img ... onerror="
  // are inert text and must not trip this — the regex requires a raw "<".
  const liveEventHandlerAttrs = (html: string) => /<[a-z][a-z0-9]*\b[^>]*\son\w+\s*=/i.test(html);

  test("renders every adversarial case to a pinned, inert snapshot", () => {
    const rendered = renderMarkdown(fixture, "example");
    expect(rendered).toMatchSnapshot();
  });

  test("targeted invariants survive a snapshot update", () => {
    const rendered = renderMarkdown(fixture, "example");

    expect(rendered).not.toContain("<script");
    expect(rendered).not.toContain("<img"); // images always become <a> or plain text
    expect(liveEventHandlerAttrs(rendered)).toBe(false);
    expect(unsafeAttrs(rendered)).toEqual([]);

    // Plain javascript:/data: targets: markdown-it's own core refuses them
    // outright, so the source syntax never becomes a link/image at all.
    expect(rendered).toContain("[plain-js](javascript:alert('plain-js'))");
    expect(rendered).toContain("[plain-data](data:text/html,&lt;script&gt;alert('plain-data')&lt;/script&gt;)");
    expect(rendered).toContain("![plain-js-img](javascript:alert('plain-js-img'))");

    // Targets outside markdown-it's own denylist: real tokens this renderer
    // itself must block (empty href, no live target).
    expect(rendered).toContain('<a href="">ftp-scheme</a>');
    expect(rendered).toContain('<a href="">tel-scheme</a>');
    expect(rendered).toContain(">allowed-mime-data-img<"); // alt text only, no <a> wrapper
    expect(rendered).not.toContain('href="ftp:');
    expect(rendered).not.toContain('href="tel:');
    expect(rendered).not.toContain("data:image/png");

    // Safe targets keep working.
    expect(rendered).toContain('<a href="mailto:security@example.com">safe-mail</a>');
    expect(rendered).toContain('<a href="https://example.com/safe">safe-https</a>');
    expect(rendered).toContain('<a href="https://skills.cloudcompute.com/skills/example/references/guide.md">relative-sibling</a>');
    expect(rendered).toContain('<a href="https://skills.cloudcompute.com/skills/example/scripts/tool.py">relative-script</a>');
    expect(rendered).toContain('<a href="#level-6-heading-stays-clamped-at-6">anchor</a>');

    // Autolink-looking bare text: linkify is off, so it stays plain text.
    expect(rendered).toContain("Visit http://example.com/should-not-autolink or write to nobody@example.com");
    expect(rendered).not.toContain('href="http://example.com/should-not-autolink"');
    expect(rendered).not.toContain('href="mailto:nobody@example.com"');

    // Reference-style links.
    expect(rendered).toContain("[reference-unsafe][evil]"); // definition itself refused
    expect(rendered).toContain('<a href="">reference-tel</a>');
    expect(rendered).toContain('<a href="https://example.com/reference-ok">reference-safe</a>');

    // Unicode look-alike scheme tricks resolve safely under the base URL —
    // never as a literal "javascript:" target.
    expect(rendered).toContain('<a href="https://skills.cloudcompute.com/skills/example/javascript%EF%BC%9Aalert(\'fullwidth\')">fullwidth-colon</a>');
    expect(rendered).toContain('<a href="https://skills.cloudcompute.com/skills/example/j%D0%B0vascript:alert(\'cyrillic\')">cyrillic-a</a>');

    // Heading shift clamps at 6 instead of overflowing.
    expect(rendered).toContain('<h6 id="level-6-heading-stays-clamped-at-6">Level 6 heading stays clamped at 6</h6>');
    expect(rendered).not.toMatch(/<h[7-9]/);
  });

  test("composed into the full skill page, the same invariants hold", () => {
    // renderSkillPage's CONTENT value is exactly renderMarkdown's output
    // substituted once into a static template (see skill-page.ts); this
    // confirms composition doesn't reintroduce risk at the seam — e.g. the
    // outer {{TOKEN}} substitution does not re-scan and re-expand content
    // that happens to contain literal "{{...}}"-shaped text.
    const page = renderSkillPage(template, "example", "Adversarial fixture", fixture, ["SKILL.md"]);

    // The rendered article is where the fixture's content lands; the page
    // template itself legitimately carries one <script> for the copy-to-
    // clipboard button, so the "<script"/"<img" checks are scoped to the
    // article rather than the whole page.
    const article = /<article[^>]*>([\s\S]*?)<\/article>/.exec(page)?.[1];
    expect(article).toBeDefined();
    expect(article).not.toContain("<script");
    expect(article).not.toContain("<img");
    expect(article).toContain('<h6 id="level-6-heading-stays-clamped-at-6">Level 6 heading stays clamped at 6</h6>');

    // href/src allow-list and live event-handler attributes are checked
    // across the whole page: it must hold everywhere, not just the article.
    expect(liveEventHandlerAttrs(page)).toBe(false);
    expect(unsafeAttrs(page)).toEqual([]);
  });
});
