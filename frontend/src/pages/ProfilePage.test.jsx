import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import ProfilePage from './ProfilePage.jsx';

// Profile contract: the page re-reads GET /auth/me (the context user only
// paints first), shows loading/error states with a retry, and signs out
// through the shared logout -> /login path. fetch is stubbed per scenario.

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

const meUser = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function renderProfile() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/login" element={<h1>Sign in</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

function meCalls() {
  return globalThis.fetch.mock.calls.filter(([url]) => String(url).includes('/auth/me'));
}

afterEach(() => {
  delete globalThis.fetch;
});

describe('profile page', () => {
  it('shows the four fields /auth/me returns', async () => {
    globalThis.fetch = jest.fn((url) => {
      const target = String(url);
      if (target.includes('/auth/me')) {
        return Promise.resolve(jsonResponse(200, { success: true, data: { user: meUser } }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${target}`));
    });

    renderProfile();

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    // Member since formats the ISO date; the year is locale-independent.
    const dd = screen.getAllByRole('definition');
    expect(dd.find((node) => /2026/.test(node.textContent))).toBeTruthy();
    expect(screen.getByText(meUser.id)).toBeInTheDocument();
    // Bootstrap + page re-read both hit /auth/me.
    await waitFor(() => expect(meCalls().length).toBeGreaterThanOrEqual(2));
    expect(meCalls().every(([, init]) => !init || init.method === 'GET')).toBe(true);
  });

  it('reports the loading state while the request is pending', async () => {
    globalThis.fetch = jest.fn(() => new Promise(() => {}));

    renderProfile();

    expect(await screen.findByRole('status')).toHaveTextContent('Loading profile…');
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
  });

  it('shows an error banner and recovers when the retry succeeds', async () => {
    let offline = true;
    globalThis.fetch = jest.fn((url) => {
      const target = String(url);
      if (target.includes('/auth/me')) {
        if (offline) return Promise.reject(new Error('offline'));
        return Promise.resolve(jsonResponse(200, { success: true, data: { user: meUser } }));
      }
      if (target.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse(401, { success: false, error: {} }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${target}`));
    });
    const client = userEvent.setup();

    renderProfile();

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your profile');
    offline = false;
    await client.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('signs out through the shared logout and lands on the login page', async () => {
    globalThis.fetch = jest.fn((url) => {
      const target = String(url);
      if (target.includes('/auth/me')) {
        return Promise.resolve(jsonResponse(200, { success: true, data: { user: meUser } }));
      }
      if (target.includes('/auth/logout')) {
        return Promise.resolve(jsonResponse(200, { success: true }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${target}`));
    });
    const client = userEvent.setup();

    renderProfile();
    await screen.findByText('Ada Lovelace');

    await client.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    const logout = globalThis.fetch.mock.calls.find(([url]) =>
      String(url).includes('/auth/logout'),
    );
    expect(logout).toBeTruthy();
    expect(logout[1].method).toBe('POST');
  });
});
