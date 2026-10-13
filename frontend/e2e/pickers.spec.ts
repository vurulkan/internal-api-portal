import { expect, test } from '@playwright/test';

// Pickers inside drawers must open above the drawer and take a mouse click (2.1.0:
// their lists opened behind it). jsdom has no stacking, so only a browser sees this.
// Nothing is saved: the other specs share the database.

test.use({ storageState: 'e2e/.auth/admin.json', viewport: { width: 1440, height: 900 } });

test('API drawer: methods, path prefixes and headers are chosen with the mouse', async ({ page }) => {
  await page.goto('/admin/apis');
  await page.getByRole('button', { name: /^Payments API/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Edit Payments API' });
  await drawer.getByRole('tab', { name: 'Try-it policy' }).click();
  await drawer.getByLabel('Allowed methods').click();
  await page.getByRole('option', { name: 'POST' }).click();
  await expect(drawer.getByRole('button', { name: 'Remove POST' })).toBeVisible();
  await drawer.getByLabel('Allowed path prefixes').fill('/v2');
  await page.keyboard.press('Enter');
  await expect(drawer.getByRole('button', { name: 'Remove /v2' })).toBeVisible();
  await drawer.getByRole('tab', { name: 'Headers' }).click();
  await drawer.getByLabel('Headers users may send').click();
  await page.getByRole('option', { name: 'X-Correlation-Id' }).click();
  await expect(drawer.getByRole('button', { name: 'Remove X-Correlation-Id' })).toBeVisible();
  await drawer.getByRole('tab', { name: 'General' }).click();
  await drawer.getByRole('combobox', { name: /Owner group/ }).click();
  await page.getByRole('option', { name: 'payments-team' }).click();
  await expect(drawer.getByRole('combobox', { name: /Owner group/ })).toHaveText(/payments-team/);
});

test('user and group drawers: groups and roles are chosen with the mouse', async ({ page }) => {
  await page.goto('/admin/users');
  await page.getByRole('button', { name: /^dave/ }).click();
  const user = page.getByRole('dialog', { name: 'Edit dave' });
  await user.getByRole('tab', { name: 'Groups & permissions' }).click();
  await user.getByRole('combobox').click();
  await page.getByRole('option', { name: 'auditors' }).click();
  await expect(user.getByText('auditors → auditor')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/admin/groups');
  await page.getByRole('button', { name: 'auditors' }).click();
  const group = page.getByRole('dialog', { name: 'Edit auditors' });
  await group.getByLabel('Roles').click();
  await page.getByRole('option', { name: 'api-consumer' }).click();
  await expect(group.getByRole('button', { name: 'Remove api-consumer' })).toBeVisible();
});

test('role drawer: templates, groups with the role, and what portal-wide scopes cover', async ({ page }) => {
  await page.goto('/admin/roles');
  await page.getByRole('button', { name: 'api-consumer' }).click();
  const role = page.getByRole('dialog', { name: 'Edit api-consumer' });
  // api.invoke covers invoke and view on every API: those boxes are checked and locked.
  await expect(role.getByText(/already applies to every API/)).toBeVisible();
  const invoke = role.getByRole('checkbox', { name: /Payments API: Invoke \(included by api\.invoke\)/ });
  await expect(invoke).toBeChecked();
  await expect(invoke).toBeDisabled();
  await expect(role.getByRole('checkbox', { name: 'Payments API: Manage' })).not.toBeChecked();

  await role.getByLabel('Groups with this role').click();
  await page.getByRole('option', { name: 'auditors' }).click();
  await expect(role.getByRole('button', { name: 'Remove auditors' })).toBeVisible();

  await role.getByRole('combobox', { name: 'Apply a template' }).click();
  await page.getByRole('option', { name: /Auditor/ }).click();
  await expect(role.getByRole('checkbox', { name: /audit\.view/ })).toBeChecked();
  await role.getByRole('button', { name: 'Save' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Change the permissions of api-consumer?' });
  await expect(confirm.getByText('Groups that get the role')).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
});

test('a group shows API access given on the API, which no role holds', async ({ page }) => {
  await page.goto('/admin/groups');
  await page.getByRole('button', { name: 'auditors' }).click();
  const group = page.getByRole('dialog', { name: 'Edit auditors' });
  await group.getByRole('tab', { name: 'Permissions' }).click();
  const direct = group.locator('section[aria-labelledby="gp-direct"]');
  await expect(direct.getByRole('link', { name: 'Payments API' })).toBeVisible();
  await expect(direct.getByText('api:1:view')).toBeVisible();
  await expect(group.locator('section[aria-labelledby="gp-roles"]').getByText('audit.view')).toBeVisible();
});
