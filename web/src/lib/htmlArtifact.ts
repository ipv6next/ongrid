function decodeCommonEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripMarkdownFence(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^```(?:html?|HTML?)?\s*\n([\s\S]*?)\n?```\s*$/);
  return m ? m[1].trim() : trimmed;
}

export function normalizeHtmlArtifact(raw: string): string {
  let html = stripMarkdownFence(raw);
  const looksEscaped = /^&lt;!doctype/i.test(html) || /^&lt;html/i.test(html) || /^&lt;body/i.test(html);
  if (looksEscaped) html = decodeCommonEntities(html).trim();

  const docStart = html.search(/<!doctype\s+html|<html[\s>]|<body[\s>]/i);
  if (docStart > 0) html = html.slice(docStart).trim();

  if (!/<!doctype\s+html|<html[\s>]|<body[\s>]/i.test(html)) {
    const escaped = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:pre-wrap;line-height:1.6;padding:24px;color:#18181b}</style></head><body>${escaped}</body></html>`;
  }

  return html;
}
