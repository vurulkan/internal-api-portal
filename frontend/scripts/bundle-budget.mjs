// Fails when the JavaScript loaded on the first page view exceeds the budget
// (DESIGN / M6: 300 KB gzip). Lazy chunks (admin, API page, Swagger UI) don't count.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const BUDGET = 300 * 1024;
const dist = new URL('../dist/', import.meta.url).pathname;
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const initial = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);

let total = 0;
for (const file of initial) {
  const size = gzipSync(readFileSync(join(dist, file))).length;
  total += size;
  console.log(`${(size / 1024).toFixed(1).padStart(7)} KB  ${file}`);
}
console.log(`${(total / 1024).toFixed(1).padStart(7)} KB  initial JavaScript (gzip), budget ${BUDGET / 1024} KB`);
if (total > BUDGET) {
  console.error('Initial JavaScript is over budget.');
  process.exit(1);
}
