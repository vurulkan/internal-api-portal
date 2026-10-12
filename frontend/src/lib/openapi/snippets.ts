import { isSensitiveHeader } from './request';

export type SnippetInput = {
  method: string;
  /** Resolved path, with the query string. */
  url: string;
  headers: Record<string, string>;
  /** Headers the portal adds (names only): shown as placeholders. */
  injected: string[];
  body: string;
  /** The real upstream base URL (API managers only); otherwise $BASE_URL. */
  baseUrl?: string;
};

export type SnippetLanguage = 'curl' | 'fetch' | 'httpie' | 'go';
export const SNIPPET_LANGUAGES: SnippetLanguage[] = ['curl', 'fetch', 'httpie', 'go'];

/** Header values safe to print: secrets and injected headers become <Name> placeholders. */
function printableHeaders(input: SnippetInput): [string, string][] {
  const rows: [string, string][] = Object.entries(input.headers).map(([name, value]) => [
    name,
    isSensitiveHeader(name) ? `<${name}>` : value,
  ]);
  for (const name of input.injected) {
    if (!rows.some(([n]) => n.toLowerCase() === name.toLowerCase())) rows.push([name, `<${name}>`]);
  }
  return rows;
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const jsString = (value: string) => JSON.stringify(value);

export function snippet(language: SnippetLanguage, input: SnippetInput): string {
  const base = input.baseUrl?.replace(/\/$/, '') || '$BASE_URL';
  const url = `${base}${input.url}`;
  const headers = printableHeaders(input);
  const hasBody = input.body.trim() !== '';
  switch (language) {
    case 'curl': {
      const lines = [`curl -X ${input.method} ${input.baseUrl ? shellQuote(url) : `"${url}"`}`];
      headers.forEach(([n, v]) => lines.push(`  -H ${shellQuote(`${n}: ${v}`)}`));
      if (hasBody) lines.push(`  --data-raw ${shellQuote(input.body)}`);
      return lines.join(' \\\n');
    }
    case 'httpie': {
      const parts = [`http ${input.method} ${input.baseUrl ? shellQuote(url) : `"${url}"`}`];
      headers.forEach(([n, v]) => parts.push(`  ${shellQuote(`${n}:${v}`)}`));
      if (hasBody) parts.push(`  --raw ${shellQuote(input.body)}`);
      return parts.join(' \\\n');
    }
    case 'fetch': {
      const lines = [
        `const response = await fetch(${input.baseUrl ? jsString(url) : '`${BASE_URL}' + input.url.replace(/`/g, '\\`') + '`'}, {`,
        `  method: ${jsString(input.method)},`,
      ];
      if (headers.length) {
        lines.push('  headers: {');
        headers.forEach(([n, v]) => lines.push(`    ${jsString(n)}: ${jsString(v)},`));
        lines.push('  },');
      }
      if (hasBody) lines.push(`  body: ${jsString(input.body)},`);
      lines.push('});', 'console.log(response.status, await response.text());');
      return lines.join('\n');
    }
    case 'go': {
      const lines = [
        'package main',
        '',
        'import (',
        '\t"fmt"',
        '\t"io"',
        '\t"net/http"',
        ...(input.baseUrl ? [] : ['\t"os"']),
        ...(hasBody ? ['\t"strings"'] : []),
        ')',
        '',
        'func main() {',
        `\turl := ${input.baseUrl ? jsString(url) : `os.Getenv("BASE_URL") + ${jsString(input.url)}`}`,
        `\treq, err := http.NewRequest(${jsString(input.method)}, url, ${hasBody ? `strings.NewReader(${jsString(input.body)})` : 'nil'})`,
        '\tif err != nil {',
        '\t\tpanic(err)',
        '\t}',
        ...headers.map(([n, v]) => `\treq.Header.Set(${jsString(n)}, ${jsString(v)})`),
        '\tresp, err := http.DefaultClient.Do(req)',
        '\tif err != nil {',
        '\t\tpanic(err)',
        '\t}',
        '\tdefer resp.Body.Close()',
        '\tbody, _ := io.ReadAll(resp.Body)',
        '\tfmt.Println(resp.Status, string(body))',
        '}',
      ];
      return lines.join('\n');
    }
  }
}
