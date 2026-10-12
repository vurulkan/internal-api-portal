import { expect, test, type Page } from '@playwright/test';

// Budgets on the internal network: the largest contentful paint under 2 s, and no
// interaction (a keystroke in a filter, opening the palette) slower than 200 ms,
// with a 1500-operation spec. Measured on the CI runner, without throttling.

test.use({ storageState: 'e2e/.auth/admin.json', viewport: { width: 1440, height: 900 } });

async function lcp(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          resolve(entries[entries.length - 1].startTime);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      }),
  );
}

async function watchInteractions(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __slowest: number };
    w.__slowest = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__slowest = Math.max(w.__slowest, e.duration);
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  });
}

const slowest = (page: Page) => page.evaluate(() => (window as unknown as { __slowest: number }).__slowest);

test('catalog and a large API reference stay within the budgets', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'API Catalog' })).toBeVisible();
  const catalogLcp = await lcp(page);
  console.log(`catalog LCP ${Math.round(catalogLcp)} ms`);
  expect(catalogLcp, 'catalog LCP (ms)').toBeLessThan(2000);

  await page.goto('/apis/warehouse/reference');
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
  const referenceLcp = await lcp(page);
  console.log(`reference LCP (1500 operations) ${Math.round(referenceLcp)} ms`);
  expect(referenceLcp, 'reference LCP with 1500 operations (ms)').toBeLessThan(2000);

  await watchInteractions(page);
  const filter = page.getByLabel('Filter operations');
  await filter.click();
  await page.keyboard.type('shelf 74', { delay: 30 });
  await expect(page.getByText(/^\d+ operations?$/)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('store item', { delay: 30 });
  await expect(page.getByRole('option').first()).toBeVisible();
  // Let the last events be reported.
  await page.waitForTimeout(300);
  const worst = await slowest(page);
  console.log(`slowest interaction ${Math.round(worst)} ms`);
  expect(worst, 'slowest interaction (ms)').toBeLessThan(200);
});
