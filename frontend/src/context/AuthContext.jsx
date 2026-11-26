import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { setUnauthorizedHandler } from '../lib/api';

// Session state for the whole app (architecture 6.6 / 7.2). The httpOnly
// cookie is the source of truth; this context only mirrors what
// GET /auth/me reports, so guards can render the right screen.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready'

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));

    let cancelled = false;
    (async () => {
      try {
        const data = await api.get('/auth/me');
        if (!cancelled) {
          setUser(data.user);
        }
      } catch {
        // 401 without a session is the normal first-visit case; a network
        // failure also lands logged out, with the login form as the way in.
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setStatus('ready');
        }
      }
    })();

    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
    };
  }, []);

  const login = useCallback(async (credentials) => {
    const data = await api.post('/auth/login', credentials);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback((payload) => api.post('/auth/register', payload), []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Offline or already-expired session: clear locally anyway (7.3 #10);
      // the server-side token dies on its own schedule.
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, status, login, register, logout }),
    [user, status, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}
