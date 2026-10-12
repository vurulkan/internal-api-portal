import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { catalog, meResponse, publicRoutes } from '@/test/fixtures';
import { apiError, mockFetch } from '@/test/fetchMock';
import { renderApp } from '@/test/render';
import { expectNoA11yViolations } from '@/test/a11y';

const searchResult = {
  query: 'charg',
  apis: [catalog[0]],
  operations: [
    {
      apiId: 1,
      apiName: 'Payments API',
      apiSlug: 'payments',
      method: 'POST',
      path: '/v1/charges',
      operationId: 'createCharge',
      summary: 'Create a charge',
    },
    {
      apiId: 1,
      apiName: 'Payments API',
      apiSlug: 'payments',
      method: 'DELETE',
      path: '/v1/charges/{id}',
      summary: 'Cancel a charge',
      deprecated: true,
    },
  ],
};

function routes(extra: Record<string, unknown> = {}, me = meResponse()) {
  return {
    ...publicRoutes,
    'GET /api/auth/me': me,
    'GET /api/catalog': catalog,
    'GET /api/search': searchResult,
    ...extra,
  };
}

describe('catalog page', () => {
  it('restores filters, sort and layout from the URL', async () => {
    mockFetch(routes());
    renderApp('/?tag=core&status=favorites&view=list&sort=viewed');
    const table = await screen.findByRole('table', { name: 'API Catalog' });
    expect(within(table).getByRole('link', { name: 'Identity API' })).toBeInTheDocument();
    expect(within(table).queryByRole('link', { name: 'Payments API' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'core' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'My favorites' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    const chips = screen.getByRole('group', { name: 'Active filters' });
    expect(within(chips).getByRole('button', { name: 'Remove filter #core' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('searches operations as you type, highlights the match and links to the operation', async () => {
    const calls = mockFetch(routes());
    const user = userEvent.setup();
    const { router } = renderApp('/');
    await screen.findByRole('link', { name: 'Payments API' });
    await user.type(screen.getByRole('searchbox', { name: 'Search APIs and operations' }), 'charg');
    expect(router.state.location.search).toBe('?q=charg');
    const section = await screen.findByRole('region', { name: '2 operations' });
    const link = within(section).getByRole('link', { name: 'POST /v1/charges Create a charge Payments API' });
    expect(link).toHaveAttribute('href', `/apis/1?${new URLSearchParams({ op: 'POST /v1/charges', tab: 'try' })}`);
    // Marked in the path and in the summary.
    expect(within(link).getAllByText('charg', { selector: 'mark' })).toHaveLength(2);
    expect(within(section).getByText('Deprecated')).toBeInTheDocument();
    // Debounced: one request for the whole word, not one per keystroke.
    await waitFor(() =>
      expect(calls.filter((c) => c.url.startsWith('/api/search')).map((c) => c.url)).toEqual(['/api/search?q=charg']),
    );
  });

  it('stars an API at once and rolls back when saving fails', async () => {
    let fail = false;
    const calls = mockFetch(
      routes({ 'PUT /api/me/favorites/1': () => (fail ? apiError(500, 'database is locked') : { favorite: true }) }),
    );
    const user = userEvent.setup();
    renderApp('/');
    const star = await screen.findByRole('button', { name: 'Add Payments API to favorites' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    await user.click(star);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/me/favorites/1')).toBe(true));

    fail = true;
    // Reload the catalog with Payments unstarred, then fail the next star.
    mockFetch(routes({ 'PUT /api/me/favorites/1': () => apiError(500, 'database is locked') }));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    const again = await screen.findByRole('button', { name: 'Add Payments API to favorites' });
    await user.click(again);
    expect(await screen.findByText('database is locked')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add Payments API to favorites' })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );
  });

  it('shows favorites and recently viewed when nothing is filtered, and spec problems', async () => {
    mockFetch(routes());
    const user = userEvent.setup();
    const { router } = renderApp('/');
    const favorites = await screen.findByRole('region', { name: 'Favorites' });
    expect(within(favorites).getByRole('link', { name: 'Identity API' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Recently viewed' })).toBeInTheDocument();
    expect(screen.getByText('Spec error')).toBeInTheDocument();
    expect(screen.getByText('v2.3.1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /1 spec problem/ }));
    expect(router.state.location.search).toBe('?status=specError');
    expect(screen.queryByRole('region', { name: 'Favorites' })).not.toBeInTheDocument();
  });

  it('has a separate empty state for no APIs (by role), no match and errors', async () => {
    mockFetch(routes({ 'GET /api/catalog': [] }));
    const first = renderApp('/');
    const cta = await screen.findByRole('link', { name: 'Add the first API' });
    expect(cta).toHaveAttribute('href', '/admin/apis?new=1');
    first.unmount();

    mockFetch(
      routes(
        { 'GET /api/catalog': [] },
        meResponse(
          { isAdmin: false },
          {
            capabilities: {
              adminSections: [],
              managesAllApis: false,
              managedApis: [],
              canCreateApi: false,
              canExportAudit: false,
            },
          },
        ),
      ),
    );
    const second = renderApp('/');
    expect(await screen.findByText(/Ask your administrator/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add the first API' })).not.toBeInTheDocument();
    second.unmount();

    mockFetch(routes());
    const user = userEvent.setup();
    renderApp('/?q=nothing-like-this');
    expect(await screen.findByText('No APIs match')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(await screen.findByRole('link', { name: 'Payments API' })).toBeInTheDocument();
  });

  it('cards: the title opens the API, the star and "Try it" are separate stops', async () => {
    mockFetch(routes());
    renderApp('/');
    const title = await screen.findByRole('link', { name: 'Payments API' });
    const card = title.closest('article')!;
    const stops = [...card.querySelectorAll<HTMLElement>('a[href], button')];
    expect(stops.map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual([
      'Payments API',
      'Add Payments API to favorites',
      'Try Payments API',
    ]);
    // No link inside a link.
    expect(card.querySelector('a a')).toBeNull();
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme (cards and table)', async (theme) => {
    localStorage.setItem('portal.theme', theme);
    mockFetch(routes());
    const view = renderApp('/?q=charg');
    await screen.findByRole('region', { name: '2 operations' });
    await expectNoA11yViolations();
    view.unmount();
    mockFetch(routes());
    renderApp('/?view=list');
    await screen.findByRole('table', { name: 'API Catalog' });
    await expectNoA11yViolations();
  });
});
