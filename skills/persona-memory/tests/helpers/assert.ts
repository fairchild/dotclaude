export function parseJsonOrThrow<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`Expected JSON output, got: ${raw}\n${String(error)}`);
  }
}

export function totalSnippetChars(snippets: Array<{ source: string; text: string }>): number {
  return snippets.reduce((acc, snippet) => acc + `${snippet.source}: ${snippet.text}`.length + 1, 0);
}
