import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Application chrome: identity on the left, session controls on the right.
// Notes navigation joins this bar when the notes slice lands.
export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app">
      <header className="app-header">
        <Link className="brand" to="/">
          <span className="brand-mark" aria-hidden="true">
            N
          </span>
          <span className="brand-name">Notes</span>
        </Link>
        {user && (
          <div className="session">
            <span className="session-user">{user.fullName}</span>
            <button className="btn btn-quiet" type="button" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        )}
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
