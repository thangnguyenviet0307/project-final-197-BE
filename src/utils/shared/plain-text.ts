// Extract retrieval text with a forward-only scan. Malformed/unclosed markup is
// discarded conservatively; this is not an HTML renderer or sanitizer.
export function plainText(value: string): string {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf('<', cursor);
    if (start < 0) {
      parts.push(value.slice(cursor));
      break;
    }
    parts.push(value.slice(cursor, start), ' ');
    if (value.startsWith('<!--', start)) {
      const end = value.indexOf('-->', start + 4);
      if (end < 0) break;
      cursor = end + 3;
      continue;
    }
    let end = start + 1;
    let quote = '';
    for (; end < value.length; end++) {
      const character = value[end]!;
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (end === value.length) break;
    const tag = /^\s*(script|style)(?=[\s/>]|$)/i.exec(
      value.slice(start + 1, end)
    );
    cursor = end + 1;
    if (tag) {
      const name = tag[1]!.toLowerCase();
      const closingTag = new RegExp('</' + name + '(?=[\\s>])', 'gi');
      closingTag.lastIndex = cursor;
      const match = closingTag.exec(value);
      if (!match) break;
      const close = match.index;
      const closeEnd = value.indexOf('>', close);
      if (closeEnd < 0) break;
      cursor = closeEnd + 1;
    }
  }
  return parts
    .join('')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
