import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import LoginPage from './LoginPage.jsx';

// Login form behaviour against a stubbed API: client-side validation must
// fire before any network call, and a real submit must hit the documented
// endpoint with cookies and the CSRF header.

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

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

function loginCalls() {
  return globalThis.fetch.mock.calls.filter(([url]) => String(url).includes('/auth/login'));
}

afterEach(() => {
  delete globalThis.fetch;
});

describe('login page', () => {
  it('shows required-field errors without calling the API', async () => {
    // Session bootstrap fails as a network error: no 401, so no refresh.
    globalThis.fetch = jest.fn(() => Promise.reject(new Error('offline')));
    const client = userEvent.setup();

    renderLogin();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));

    await client.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(loginCalls()).toHaveLength(0);
  });

  it('posts credentials to /auth/login with cookies and the CSRF header', async () => {
    const user = {
      id: 'u1',
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    globalThis.fetch = jest.fn((url) => {
      const target = String(url);
      if (target.includes('/auth/me') || target.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse(401, unauthorized));
      }
      if (target.includes('/auth/login')) {
        return Promise.resolve(jsonResponse(200, { success: true, data: { user } }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${target}`));
    });
    const client = userEvent.setup();

    renderLogin();
    // /auth/me 401 -> one silent refresh 401 before the form is used.
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));

    await client.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await client.type(screen.getByLabelText('Password'), 'Str0ngPass1');
    await client.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(loginCalls()).toHaveLength(1));
    const [url, init] = loginCalls()[0];
    expect(String(url)).toBe('/api/v1/auth/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['X-Requested-With']).toBe('notes-app');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      email: 'ada@example.com',
      password: 'Str0ngPass1',
    });
  });

  it('surfaces the server message for bad credentials', async () => {
    globalThis.fetch = jest.fn((url) => {
      const target = String(url);
      if (target.includes('/auth/me') || target.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse(401, unauthorized));
      }
      if (target.includes('/auth/login')) {
        return Promise.resolve(
          jsonResponse(401, {
            success: false,
            error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${target}`));
    });
    const client = userEvent.setup();

    renderLogin();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));

    await client.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await client.type(screen.getByLabelText('Password'), 'wrongpass1');
    await client.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Email or password is incorrect')).toBeInTheDocument();
  });
});
