import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import NotesPage from './NotesPage.jsx';

// List contract (architecture 5.3 #6): GET /notes with q/tag/pinned/sort/page
// in the query, a meta block for pagination, excerpt-only rows, and real
// loading / empty / error states. fetch is stubbed per scenario.

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

const unauthorized = {
  success: false,
  error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
};

const meta = { page: 1, limit: 20, total: 1, totalPages: 1 };

const groceryNote = {
  id: 'n1',
  title: 'Grocery list',
  excerpt: 'Weekly shop and pantry restock',
  isPinned: true,
  tags: ['home'],
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-02T10:30:00.000Z',
};

function makeFetch(routes) {
  return jest.fn((url) => {
    const target = String(url);
    if (target.includes('/auth/me') || target.includes('/auth/refresh')) {
      return Promise.resolve(jsonResponse(401, unauthorized));
    }
    for (const [needle, response] of routes) {
      if (target.includes(needle)) return Promise.resolve(response);
    }
    return Promise.reject(new Error(`unexpected fetch: ${target}`));
  });
}

function renderList() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/notes']}>
        <NotesPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

afterEach(() => {
  delete globalThis.fetch;
});

describe('notes list page', () => {
  it('loads the page and renders a row with excerpt, tags, pin state and date', async () => {
    globalThis.fetch = makeFetch([
      ['/tags', jsonResponse(200, { success: true, data: [{ name: 'home', noteCount: 3 }] })],
      ['notes?', jsonResponse(200, { success: true, data: [groceryNote], meta })],
    ]);

    renderList();

    expect(screen.getByRole('status')).toHaveTextContent('Loading notes');
    expect(await screen.findByRole('link', { name: /Grocery list/ })).toBeInTheDocument();

    // Excerpt only - never the full document - plus the metadata the row shows.
    expect(screen.getByText('Weekly shop and pantry restock')).toBeInTheDocument();
    expect(screen.getByText('home')).toBeInTheDocument();
    expect(screen.getByText('Pinned')).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();

    const listCall = globalThis.fetch.mock.calls.find(([url]) => String(url).includes('/notes?'));
    expect(String(listCall[0])).toContain('/api/v1/notes?');
    expect(String(listCall[0])).toContain('sort=updated_desc');
    expect(String(listCall[0])).toContain('page=1');
  });

  it('shows the empty state when the account has no notes', async () => {
    globalThis.fetch = makeFetch([
      ['/tags', jsonResponse(200, { success: true, data: [] })],
      ['notes?', jsonResponse(200, { success: true, data: [], meta: { ...meta, total: 0 } })],
    ]);

    renderList();

    expect(await screen.findByText('No notes yet')).toBeInTheDocument();
    // Header button plus the empty-state call to action.
    expect(screen.getAllByRole('link', { name: 'New note' })).toHaveLength(2);
  });

  it('surfaces a server error and recovers through Try again', async () => {
    let listCalls = 0;
    globalThis.fetch = jest.fn((url) => {
      const target = String(url);
      if (target.includes('/auth/me') || target.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse(401, unauthorized));
      }
      if (target.includes('/tags')) {
        return Promise.resolve(jsonResponse(200, { success: true, data: [] }));
      }
      if (target.includes('notes?')) {
        listCalls += 1;
        if (listCalls === 1) {
          return Promise.resolve(
            jsonResponse(500, {
              success: false,
              error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
            }),
          );
        }
        return Promise.resolve(jsonResponse(200, { success: true, data: [groceryNote], meta }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${target}`));
    });

    renderList();

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('link', { name: /Grocery list/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('debounces the search box into the q parameter', async () => {
    globalThis.fetch = makeFetch([
      ['/tags', jsonResponse(200, { success: true, data: [] })],
      ['notes?', jsonResponse(200, { success: true, data: [groceryNote], meta })],
    ]);

    renderList();
    expect(await screen.findByRole('link', { name: /Grocery list/ })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Search notes'), 'budget');

    await waitFor(
      () => {
        const call = globalThis.fetch.mock.calls.find(([url]) => String(url).includes('q=budget'));
        expect(call).toBeTruthy();
        expect(String(call[0])).toContain('/api/v1/notes?');
      },
      { timeout: 3000 },
    );
  });
});
