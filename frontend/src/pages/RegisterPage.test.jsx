import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import LoginPage from './LoginPage.jsx';
import RegisterPage from './RegisterPage.jsx';

// Register contract: client-side validation blocks empty submits, a valid
// payload goes to POST /auth/register with the CSRF header, and success
// hands off to the login page with the confirmation notice (7.3 #1).

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

function renderRegister() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

function registerCalls() {
  return globalThis.fetch.mock.calls.filter(([url]) => String(url).includes('/auth/register'));
}

afterEach(() => {
  delete globalThis.fetch;
});

describe('register page', () => {
  it('validates the password rules before calling the API', async () => {
    // Bootstrap fails as a network error: no 401, so no refresh attempt.
    globalThis.fetch = jest.fn(() => Promise.reject(new Error('offline')));
    const client = userEvent.setup();

    renderRegister();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));

    await client.type(screen.getByLabelText('Full name'), 'Ada Lovelace');
    await client.type(screen.getByLabelText('Email'), 'ada@example.com');
    await client.type(screen.getByLabelText('Password'), 'short');
    await client.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(registerCalls()).toHaveLength(0);
  });

  it('posts the account to /auth/register and hands off to login', async () => {
    globalThis.fetch = jest.fn((url) => {
      const target = String(url);
      if (target.includes('/auth/me') || target.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse(401, unauthorized));
      }
      if (target.includes('/auth/register')) {
        return Promise.resolve(
          jsonResponse(201, {
            success: true,
            data: {
              user: {
                id: 'u1',
                fullName: 'Ada Lovelace',
                email: 'ada@example.com',
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${target}`));
    });
    const client = userEvent.setup();

    renderRegister();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));

    await client.type(await screen.findByLabelText('Full name'), '  Ada Lovelace  ');
    await client.type(screen.getByLabelText('Email'), 'ada@example.com');
    await client.type(screen.getByLabelText('Password'), 'Str0ngPass1');
    await client.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(registerCalls()).toHaveLength(1));
    const [url, init] = registerCalls()[0];
    expect(String(url)).toBe('/api/v1/auth/register');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['X-Requested-With']).toBe('notes-app');
    expect(JSON.parse(init.body)).toEqual({
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'Str0ngPass1',
    });

    // Registration does not sign anyone in - the login page confirms it.
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('Account created. Sign in to continue.')).toBeInTheDocument();
  });
});
