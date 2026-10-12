/** Lower case without diacritics, Turkish dotless i folded: "Çağrı" → "cagri". */
export function fold(text: string) {
  return text
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * How well `query` matches `text` as a subsequence (null: not at all). Contiguous
 * runs, word starts and an early first match score higher, so "pay ref" ranks
 * "Payments API · POST /refunds" above "Shipping API · repay fee".
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = fold(query).replace(/\s+/g, '');
  if (!q) return 0;
  const t = fold(text);
  let score = 0;
  let ti = 0;
  let run = 0;
  let first = -1;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    if (first === -1) first = found;
    run = found === ti ? run + 1 : 1;
    const wordStart = found === 0 || /[\s\-_/.·:]/.test(t[found - 1]);
    score += 1 + run * 2 + (wordStart ? 3 : 0);
    ti = found + 1;
  }
  if (t.includes(fold(query).trim())) score += 10;
  return score - first * 0.1 - t.length * 0.01;
}

/** The items that match, best first. */
export function fuzzyFilter<T>(query: string, items: T[], text: (item: T) => string, limit = Infinity) {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((x): x is { item: T; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);
}
