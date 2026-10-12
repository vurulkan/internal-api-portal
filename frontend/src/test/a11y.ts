import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Runs axe-core and fails with a readable list of violations. Color contrast is
 * checked in a real browser (jsdom has no layout); the tokens are verified by hand.
 */
export async function expectNoA11yViolations(container: Element = document.body) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  const report = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.html).join('\n  ')}`,
  );
  expect(report, report.join('\n')).toEqual([]);
}
