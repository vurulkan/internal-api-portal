import { Fragment } from 'react';
import { fold } from '@/lib/catalog';

/** Marks where the query occurs in text (case- and accent-insensitive). */
export function Highlight({ text, query }: { text: string; query: string }) {
  const needle = fold(query.trim());
  if (!needle || !text) return <>{text}</>;
  // fold() keeps the length of plain Latin text; when it doesn't (decomposed
  // characters), fall back to no highlighting rather than marking the wrong part.
  const folded = fold(text);
  if (folded.length !== text.length) return <>{text}</>;
  const parts: { text: string; hit: boolean }[] = [];
  let from = 0;
  for (let at = folded.indexOf(needle); at !== -1 && needle; at = folded.indexOf(needle, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), hit: false });
    parts.push({ text: text.slice(at, at + needle.length), hit: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false });
  return (
    <>
      {parts.map((part, i) =>
        part.hit ? (
          <mark key={i} className="rounded-sm bg-warning-subtle px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
