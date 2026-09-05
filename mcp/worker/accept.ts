/** RFC 9110 media ranges: specificity determines quality before candidates compete. */
function splitQuoted(value: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0, quoted = false, escaped = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === "\\") { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (!quoted && char === separator) { parts.push(value.slice(start, i)); start = i + 1; }
  }
  parts.push(value.slice(start));
  return parts;
}

function media(value: string) {
  const [type = "", ...parameters] = splitQuoted(value, ";");
  const params = new Map<string, string>();
  for (const parameter of parameters) {
    const equal = parameter.indexOf("=");
    if (equal < 1) return null;
    const key = parameter.slice(0, equal).trim().toLowerCase();
    if (params.has(key)) return null;
    params.set(key, parameter.slice(equal + 1).trim().replace(/^"(.*)"$/, "$1").replace(/\\(.)/g, "$1"));
  }
  return { type: type.trim().toLowerCase(), params };
}

export function negotiate<T extends { contentType: string }>(accept: string | null, candidates: T[]): T | undefined {
  if (accept === null) return candidates[0];
  const ranges = splitQuoted(accept, ",").flatMap(value => {
    const parsed = media(value);
    if (!parsed || !/^(\*\/\*|[\w!#$%&'+.^`|~-]+\/(?:\*|[\w!#$%&'+.^`|~-]+))$/.test(parsed.type)) return [];
    const quality = parsed.params.get("q") ?? "1";
    if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(quality)) return [];
    parsed.params.delete("q");
    return [{ ...parsed, quality: Number(quality) }];
  });
  let best: T | undefined, bestQuality = 0;
  for (const candidate of candidates) {
    const offered = media(candidate.contentType)!;
    let specificity = -1, quality = 0;
    for (const range of ranges) {
      const matches = range.type === "*/*" || range.type === offered.type ||
        range.type === `${offered.type.split("/")[0]}/*`;
      if (!matches || [...range.params].some(([key, value]) => {
        const actual = offered.params.get(key);
        return key === "charset" ? actual?.toLowerCase() !== value.toLowerCase() : actual !== value;
      })) continue;
      const rank = (range.type === "*/*" ? 0 : range.type.endsWith("/*") ? 1 : 2) * 1000 + range.params.size;
      if (rank > specificity) { specificity = rank; quality = range.quality; }
    }
    // Server preference (candidate order) breaks equal-quality ties.
    if (quality > bestQuality) { best = candidate; bestQuality = quality; }
  }
  return best;
}
