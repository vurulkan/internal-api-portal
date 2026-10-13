import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { catalog, meResponse, publicRoutes } from '@/test/fixtures';
import { mockFetch } from '@/test/fetchMock';
import { renderApp } from '@/test/render';
import { expectNoA11yViolations } from '@/test/a11y';

const routes = { ...publicRoutes, 'GET /api/auth/me': meResponse(), 'GET /api/catalog': catalog };

describe('remembered preferences', () => {
  it('the catalog keeps the last view and sort', async () => {
    mockFetch(routes);
    const user = userEvent.setup();
    const first = renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Table' }));
    await user.click(screen.getByRole('combobox', { name: 'Sort by' }));
    await user.click(await screen.findByRole('option', { name: 'Recently viewed by me' }));
    first.unmount();

    // A later visit to the plain catalog opens as it was left.
    const second = renderApp('/');
    expect(await screen.findByRole('table', { name: 'API Catalog' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveTextContent('Recently viewed by me');
    // Switching back to cards is remembered too.
    await user.click(screen.getByRole('button', { name: 'Cards' }));
    second.unmount();
    renderApp('/');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cards' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('the theme survives a reload', async () => {
    mockFetch(routes);
    const user = userEvent.setup();
    const first = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'API Catalog' });
    await user.click(screen.getByRole('button', { name: /^Theme/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    first.unmount();
    document.documentElement.classList.remove('dark');
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'API Catalog' });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('shell', () => {
  it('the rail links to the project with the version; the shortcuts window shows it too', async () => {
    mockFetch({ ...routes, 'GET /api/auth/me': meResponse({}, { version: '2.1.4', projectLink: true }) });
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'API Catalog' });
    const rail = screen.getByRole('navigation', { name: 'Main navigation' });
    const link = within(rail).getByRole('link', { name: /Internal API Portal 2\.1\.4 · GitHub/ });
    expect(link).toHaveAttribute('href', 'https://github.com/vurulkan/internal-api-portal');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // Nothing at the bottom of the page any more.
    expect(within(screen.getByRole('main')).queryByRole('link', { name: /GitHub/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    const help = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(help).getByText('Version 2.1.4')).toBeInTheDocument();
    expect(within(help).getByRole('link', { name: /GitHub/ })).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('SHOW_PROJECT_LINK=false hides the link; the version stays in the shortcuts window', async () => {
    mockFetch({ ...routes, 'GET /api/auth/me': meResponse({}, { version: '2.1.4', projectLink: false }) });
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'API Catalog' });
    expect(screen.queryByRole('link', { name: /GitHub/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    const help = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(help).getByText('Version 2.1.4')).toBeInTheDocument();
    expect(within(help).queryByRole('link', { name: /GitHub/ })).not.toBeInTheDocument();
  });

  it('the sign-in page links to the project under the form, without a version', async () => {
    mockFetch({
      ...publicRoutes,
      'GET /api/system/public': { brandTitle: 'Acme API Portal', logoDataUrl: '', projectLink: true },
      'GET /api/auth/me': () => new Response('{}', { status: 401 }),
    });
    renderApp('/login');
    const link = await screen.findByRole('link', { name: /Internal API Portal · GitHub/ });
    expect(link.textContent).not.toMatch(/\d+\.\d+/);
  });

  it('the sign-in page hides it with SHOW_PROJECT_LINK=false', async () => {
    mockFetch({
      ...publicRoutes,
      'GET /api/system/public': { brandTitle: 'Acme API Portal', logoDataUrl: '', projectLink: false },
      'GET /api/auth/me': () => new Response('{}', { status: 401 }),
    });
    renderApp('/login');
    await screen.findByRole('button', { name: 'Sign in' });
    // Once the public settings are in (the brand title shows), still no link.
    await screen.findByText('Acme API Portal');
    expect(screen.queryByRole('link', { name: /GitHub/ })).not.toBeInTheDocument();
  });
});

describe('audit filters', () => {
  it('a period keeps the date fields in place, disabled, so nothing jumps', async () => {
    mockFetch({ ...routes, 'GET /api/admin/audit-logs': { items: [], total: 0, limit: 25, offset: 0 } });
    const user = userEvent.setup();
    renderApp('/admin/audit');
    const from = await screen.findByLabelText(/^From/);
    expect(from).toBeEnabled();
    await user.click(screen.getByRole('combobox', { name: 'Period' }));
    await user.click(await screen.findByRole('option', { name: 'Last 24 hours' }));
    await waitFor(() => expect(screen.getByLabelText(/^From/)).toBeDisabled());
    expect(screen.getByLabelText(/^From/)).not.toHaveValue('');
    expect(screen.getByLabelText(/^To/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });
});
