import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// WCAG 2.2 A / AA (colour contrast and target size included), in both themes, at
// phone and desktop width, on every route and the main dialogs and drawers.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SECRET = 'e2e-inject-secret-5150';

const ROUTES = [
  '/',
  '/?view=list',
  '/apis/payments/overview',
  '/apis/payments/reference',
  '/apis/payments/operations/createCharge',
  '/apis/payments/classic',
  '/apis/payments/access',
  '/apis/payments/activity',
  '/apis/ledger/overview',
  '/account',
  '/admin/overview',
  '/admin/users',
  '/admin/groups',
  '/admin/roles',
  '/admin/sessions',
  '/admin/apis',
  '/admin/identity?tab=ldap',
  '/admin/identity?tab=azure',
  '/admin/audit?range=24h',
  '/admin/settings?tab=session',
  '/admin/settings?tab=branding',
  '/admin/settings?tab=system',
];

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1440, height: 900 },
];

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main h1').first()).toBeVisible();
}

async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(TAGS)
    // Swagger UI (the Classic tab) is third-party markup, kept for familiarity; the
    // own reference is the accessible view.
    .exclude('.swagger-ui')
    .analyze();
  const report = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}) ${v.help}\n  ${v.nodes
        .map((n) => n.target.join(' '))
        .slice(0, 5)
        .join('\n  ')}`,
  );
  expect(report, `${label}\n${report.join('\n')}`).toEqual([]);
  const html = await page.content();
  expect(html.includes(SECRET), `${label}: injected header value in the page`).toBe(false);
  // With a dialog open the page behind it is locked (and padded for the scrollbar).
  const overflow = await page.evaluate(() =>
    document.querySelector('[role="dialog"][data-state="open"]')
      ? 0
      : document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);
}

test.use({ storageState: 'e2e/.auth/admin.json' });

for (const scheme of ['light', 'dark'] as const) {
  for (const viewport of VIEWPORTS) {
    test.describe(`${scheme} ${viewport.name}`, () => {
      test.use({ colorScheme: scheme, viewport });

      for (const route of ROUTES) {
        test(`page ${route}`, async ({ page }) => {
          const csp: string[] = [];
          page.on('console', (msg) => {
            if (msg.type() === 'error' && !/status of (401|403|404|502)/.test(msg.text())) csp.push(msg.text());
          });
          await page.goto(route);
          await settle(page);
          await expectAccessible(page, `${scheme} ${viewport.width} ${route}`);
          expect(csp, 'console errors').toEqual([]);
        });
      }

      test('command palette and shortcut help', async ({ page }) => {
        await page.goto('/');
        await settle(page);
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByRole('combobox', { name: /Search commands/ }).fill('char');
        await expect(page.getByRole('option', { name: /\/v1\/charges/ }).first()).toBeVisible();
        await expectAccessible(page, 'palette');
        await page.keyboard.press('Escape');
        await page.keyboard.press('?');
        await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
        await expectAccessible(page, 'help');
      });

      test('admin drawers and the API wizard', async ({ page }) => {
        await page.goto('/admin/users');
        await settle(page);
        await page.getByRole('button', { name: /^bob/ }).click();
        const drawer = page.getByRole('dialog', { name: 'Edit bob' });
        for (const tab of ['Profile', 'Groups & permissions', 'Sessions']) {
          await drawer.getByRole('tab', { name: tab }).click();
          await page.waitForLoadState('networkidle');
          await expectAccessible(page, `user drawer ${tab}`);
        }
        await page.keyboard.press('Escape');
        await page.goto('/admin/users');
        await settle(page);
        await page.getByRole('button', { name: 'More ways to add users' }).click();
        // Not scanned while open: a Radix menu hides the page (aria-hidden) and traps
        // focus, which axe reports as aria-hidden-focus (the theme and language menus too).
        await page.getByRole('menuitem', { name: 'From LDAP…' }).click();
        await expect(page.getByRole('dialog', { name: 'Import from LDAP' })).toBeVisible();
        await expectAccessible(page, 'LDAP import drawer');
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'More ways to add users' }).click();
        await page.getByRole('menuitem', { name: 'Azure AD user…' }).click();
        await expect(page.getByRole('dialog', { name: 'Add an Azure AD user' })).toBeVisible();
        await expectAccessible(page, 'Azure AD pre-registration');
        await page.keyboard.press('Escape');
        await page.goto('/admin/apis?new=1');
        const wizard = page.getByRole('dialog', { name: 'New API' });
        await wizard.getByLabel(/Internal OpenAPI URL/).fill('http://127.0.0.1:18096/openapi.json');
        await wizard.getByRole('button', { name: 'Preview spec' }).click();
        await expect(wizard.getByText('Readable')).toBeVisible();
        await expectAccessible(page, 'wizard preview');
        await wizard.getByLabel(/Internal base URL/).fill('http://127.0.0.1:18096');
        await wizard.getByRole('button', { name: /Next/ }).click();
        await expectAccessible(page, 'wizard access');
        await wizard.getByRole('button', { name: /Next/ }).click();
        await expectAccessible(page, 'wizard review');
        await page.goto('/admin/roles');
        await settle(page);
        await page.getByRole('button', { name: 'api-consumer' }).click();
        await expect(page.getByRole('dialog', { name: 'Edit api-consumer' })).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expectAccessible(page, 'role drawer');
      });
    });
  }
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const scheme of ['light', 'dark'] as const) {
    test(`login ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/login');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `login ${scheme}`);
    });
  }
});
