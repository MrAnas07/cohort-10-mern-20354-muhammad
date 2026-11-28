import { render, screen, waitFor } from '@testing-library/react';
import App from './App.jsx';

// Shell + router smoke tests: a visitor is bounced to the login form, a
// signed-in user lands on the notes list with their name in the header.
// fetch is stubbed per scenario - no server involved.

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

beforeEach(() => {
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  delete globalThis.fetch;
});

describe('app shell and routing', () => {
  it('redirects a signed-out visitor to the login form', async () => {
    globalThis.fetch = jest.fn((url) => {
      const target = String(url);
      if (target.includes('/auth/me') || target.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse(401, unauthorized));
      }
      return Promise.reject(new Error(`unexpected fetch: ${target}`));
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create one' })).toBeInTheDocument();
    // It arrived through the guard's redirect, not a hard-coded URL.
    expect(window.location.pathname).toBe('/login');
  });

  it('shows the signed-in shell once /auth/me returns a user', async () => {
    const user = {
      id: 'u1',
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    globalThis.fetch = jest.fn((url) => {
      const target = String(url);
      if (target.includes('/auth/me')) {
        return Promise.resolve(jsonResponse(200, { success: true, data: { user } }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${target}`));
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Your notes' })).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New note' })).toBeInTheDocument();
  });

  it('keeps a signed-in user away from the login page', async () => {
    const user = {
      id: 'u1',
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    globalThis.fetch = jest.fn((url) => {
      const target = String(url);
      if (target.includes('/auth/me')) {
        return Promise.resolve(jsonResponse(200, { success: true, data: { user } }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${target}`));
    });
    window.history.pushState({}, '', '/login');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Your notes' })).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/notes'));
  });
});
