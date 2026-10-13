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
  it('the keyboard icon opens the shortcuts; the project link is at the bottom', async () => {
    mockFetch(routes);
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'API Catalog' });
    const link = within(screen.getByRole('main')).getByRole('link', {
      name: /github\.com\/vurulkan\/internal-api-portal/,
    });
    expect(link).toHaveAttribute('href', 'https://github.com/vurulkan/internal-api-portal');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('the sign-in page links to the project too', async () => {
    mockFetch({ ...publicRoutes, 'GET /api/auth/me': () => new Response('{}', { status: 401 }) });
    renderApp('/login');
    expect(await screen.findByRole('link', { name: /github\.com\/vurulkan\/internal-api-portal/ })).toBeInTheDocument();
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
