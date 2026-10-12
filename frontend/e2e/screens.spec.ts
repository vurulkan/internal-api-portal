import { expect, test } from '@playwright/test';

// The screenshot set for review: 6 widths × 2 themes of the main screens, written to
// e2e/.screens (uploaded by CI as an artifact). It checks nothing beyond rendering.

const WIDTHS = [375, 414, 768, 1024, 1280, 1440];
const SCREENS = [
  ['catalog', '/'],
  ['api-reference', '/apis/payments/operations/createCharge'],
  ['admin-overview', '/admin/overview'],
  ['admin-users', '/admin/users'],
] as const;

test.use({ storageState: 'e2e/.auth/admin.json' });

for (const scheme of ['light', 'dark'] as const) {
  for (const width of WIDTHS) {
    test(`screens ${scheme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      for (const [name, route] of SCREENS) {
        await page.goto(route);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('main h1').first()).toBeVisible();
        await page.screenshot({ path: `e2e/.screens/${name}-${scheme}-${width}.png`, fullPage: false });
      }
      await page.goto('/');
      await expect(page.locator('main h1').first()).toBeVisible();
      await page.keyboard.press('ControlOrMeta+k');
      await page.keyboard.type('charge');
      await expect(page.getByRole('option', { name: /\/v1\/charges/ }).first()).toBeVisible();
      await page.screenshot({ path: `e2e/.screens/palette-${scheme}-${width}.png`, fullPage: false });
    });
  }
}
