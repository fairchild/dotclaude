import { createHash } from "node:crypto";

export const escapeHtml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function validateSkillName(name: string): void {
  const match = name.match(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  if (match?.[0] !== name) throw new Error(`unsafe skill name: ${JSON.stringify(name)}`);
}

export function installPrompt(name: string, markdown: string, paths: string[]): string {
  validateSkillName(name);
  const delimiter = `SKILL_MD_${createHash("sha256").update(markdown).digest("hex").slice(0, 16)}`;
  const archiveUrl = `https://skills.cloudcompute.com/downloads/${encodeURIComponent(name)}/skill.tgz`;
  const supportingFiles = paths.filter(path => path !== "SKILL.md").map(path =>
    `- ${path}`,
  ).join("\n");
  return `Install this skill: ${name}.

Use your agent's user-level skills directory. The command below writes the complete SKILL.md to ~/.agents/skills/${name}; adapt that directory if your agent uses another location. Preserve existing local changes before replacing an installed skill.

Download the complete skill archive:
${archiveUrl}

The archive contains the ${name}/ directory, including SKILL.md and every supporting file. Download it to a temporary directory, check its contents against the manifest below, then install the verified files in your skills directory. If the archive cannot be fetched, use the supporting-file paths below and the inline SKILL.md.

Supporting-file root: https://skills.cloudcompute.com/skills/${encodeURIComponent(name)}/
All supporting-file paths are relative to this root. URL-encode each path segment when fetching.

Supporting files:
${supportingFiles || "No supporting files. This skill contains only SKILL.md."}

Fetch https://skills.cloudcompute.com/manifest.json and find the entry with frontmatter.name equal to "${name}". For each additional resource listed in that entry, remove the skill://${name}/ URI prefix and fetch the resulting relative path from the supporting-file root above. Preserve the directory structure beside SKILL.md. Accept only paths within this skill directory and verify each file's byte size and SHA-256 digest against the manifest before saving it. Verify the inline SKILL.md against the manifest too; if the hosted snapshot has changed, report the mismatch instead of mixing versions. If fetching is unavailable, install the inline SKILL.md and report which supporting files are missing. Installing files does not require executing bundled scripts.

Run this command to install SKILL.md:

mkdir -p "$HOME/.agents/skills/${name}"
cat > "$HOME/.agents/skills/${name}/SKILL.md" <<'${delimiter}'
${markdown}${markdown.endsWith("\n") ? "" : "\n"}${delimiter}${markdown.endsWith("\n") ? "" : `\n# Remove the heredoc's added newline to match the source.\nperl -pi -e 'chomp if eof' "$HOME/.agents/skills/${name}/SKILL.md"`}
`;
}

export function renderMarkdown(markdown: string, name: string): string {
  const base = `https://skills.cloudcompute.com/skills/${encodeURIComponent(name)}/`;
  const href = (value: string) => {
    try {
      const url = new URL(value, base);
      return ["https:", "http:", "mailto:"].includes(url.protocol) ? escapeHtml(value.startsWith("#") ? value : url.href) : "";
    } catch { return ""; }
  };
  return Bun.markdown.render(markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ""), {
    text: escapeHtml,
    heading: (s, { level, id }) => `<h${Math.min(level + 1, 6)}${id ? ` id="${escapeHtml(id)}"` : ""}>${s}</h${Math.min(level + 1, 6)}>`,
    paragraph: s => `<p>${s}</p>`, strong: s => `<strong>${s}</strong>`, emphasis: s => `<em>${s}</em>`,
    code: s => `<pre><code>${s}</code></pre>`, codespan: s => `<code>${s}</code>`,
    link: (s, meta) => href(meta.href) ? `<a href="${href(meta.href)}">${s}</a>` : s,
    image: (s, meta) => href(meta.src) ? `<a href="${href(meta.src)}">${s || "View image"}</a>` : s,
    list: (s, m) => m.ordered ? `<ol start="${m.start ?? 1}">${s}</ol>` : `<ul>${s}</ul>`,
    listItem: (s, m) => `<li>${m.checked === undefined ? "" : m.checked ? "☑ " : "☐ "}${s}</li>`,
    blockquote: s => `<blockquote>${s}</blockquote>`, hr: () => "<hr>", strikethrough: s => `<del>${s}</del>`,
    table: s => `<div class="table-scroll"><table>${s}</table></div>`,
    thead: s => `<thead>${s}</thead>`, tbody: s => `<tbody>${s}</tbody>`, tr: s => `<tr>${s}</tr>`,
    th: s => `<th>${s}</th>`, td: s => `<td>${s}</td>`,
  }, { headings: { ids: true }, noHtmlBlocks: true, noHtmlSpans: true });
}

export function renderSkillPage(template: string, name: string, description: string, markdown: string, paths: string[]): string {
  const values: Record<string, string> = {
    NAME: escapeHtml(name), DESCRIPTION: escapeHtml(description.split(/(?<=[.!?])\s/)[0] ?? description), RAW_URL: `/skills/${encodeURIComponent(name)}/SKILL.md`,
    CONTENT: renderMarkdown(markdown, name), PROMPT: escapeHtml(installPrompt(name, markdown, paths)),
    ARCHIVE_URL: `/downloads/${encodeURIComponent(name)}/skill.tgz`,
    FILE_COUNT: `${paths.length} ${paths.length === 1 ? "file" : "files"}`,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (token, key) => values[key] ?? token);
}
