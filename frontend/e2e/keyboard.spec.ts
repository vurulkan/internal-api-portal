import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from './portal';

// The acceptance flow of M10 without a mouse: sign in, find an API operation, call
// it, then add a user to a group in the admin console.

test.use({ storageState: { cookies: [], origins: [] } });

type Target = { id: string } | { inTryItForm: true } | { role: string } | { text: string };

/** Presses Tab until the focused element is `target` (at most `max` times). */
async function tabTo(page: Page, target: Target, max = 60) {
  for (let i = 0; i < max; i++) {
    const hit = await page.evaluate((t) => {
      const el = document.activeElement;
      if (!el) return false;
      if ('id' in t) return el.id === t.id;
      if ('inTryItForm' in t) return !!el.closest('form')?.querySelector('button[type="submit"]');
      if ('role' in t) return el.getAttribute('role') === t.role;
      return el.textContent?.trim() === t.text;
    }, target);
    if (hit) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`focus never reached ${JSON.stringify(target)}`);
}

/** ↓ in the palette until the active option's text matches. */
async function pickOption(page: Page, text: RegExp) {
  const input = page.getByRole('combobox', { name: /Search commands/ });
  for (let i = 0; i < 30; i++) {
    const id = await input.getAttribute('aria-activedescendant');
    if (id && text.test((await page.locator(`[id="${id}"]`).textContent()) ?? '')) {
      await page.keyboard.press('Enter');
      return;
    }
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`no option ${text}`);
}

test('sign in, find and call an operation, add a user to a group — keyboard only', async ({ page }) => {
  await page.goto('/login');
  await tabTo(page, { id: 'username' });
  await page.keyboard.type(ADMIN.username);
  await page.keyboard.press('Tab');
  await page.keyboard.type(ADMIN.password);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'API Catalog' })).toBeVisible();

  // ⌘K / Ctrl K → an operation found by the search index.
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('create charge');
  await expect(page.getByRole('option', { name: /\/v1\/charges/ }).first()).toBeVisible();
  await pickOption(page, /^POST.*\/v1\/charges/);
  await expect(page.getByRole('heading', { level: 2, name: 'Create a charge' })).toBeVisible();

  // Into the try-it form, then ⌘↵ sends it; the response is announced and focused.
  await tabTo(page, { inTryItForm: true });
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByText('201', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /Response received: 201/ })).toBeAttached();

  // g a → admin; the palette → Users; j to carol, Enter opens her.
  await page.locator('body').press('Escape');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('g');
  await page.keyboard.press('a');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('users');
  await pickOption(page, /Admin · Users/);
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('j');
    if ((await page.evaluate(() => document.activeElement?.textContent ?? '')).startsWith('carol')) break;
  }
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Edit carol' });
  await expect(drawer).toBeVisible();

  // ] → the Groups tab (once the form is in); the group picker; Save.
  await expect(drawer.getByRole('tab', { name: 'Profile' })).toBeVisible();
  await page.keyboard.press(']');
  await expect(drawer.getByRole('tab', { name: 'Groups & permissions' })).toHaveAttribute('aria-selected', 'true');
  await tabTo(page, { role: 'combobox' });
  await page.keyboard.type('audit');
  await page.keyboard.press('Enter');
  await expect(drawer.getByText('auditors → auditor')).toBeVisible();
  await tabTo(page, { text: 'Save' });
  await page.keyboard.press('Enter');
  await expect(page.getByText('User updated.')).toBeVisible();

  const users = await page.evaluate(async () => (await fetch('/api/admin/users')).json());
  const groups = await page.evaluate(async () => (await fetch('/api/admin/groups')).json());
  const carol = users.find((u: { username: string }) => u.username === 'carol');
  const auditors = groups.find((g: { name: string }) => g.name === 'auditors');
  expect(carol.groupIds).toContain(auditors.id);
});
