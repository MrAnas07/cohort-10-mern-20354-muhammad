import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function SessionPending() {
  return (
    <p className="route-loading" role="status">
      Checking your session…
    </p>
  );
}

// Waits for GET /auth/me before deciding, so a reload never flashes the login
// page at a signed-in user. Signed-out visitors keep the page they wanted so
// login can send them back there (architecture 6.6).
export function ProtectedRoute() {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <SessionPending />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

// Authenticated visitors skip the auth forms entirely (7.2 PublicOnlyRoute).
export function PublicOnlyRoute() {
  const { user, status } = useAuth();

  if (status === 'loading') {
    return <SessionPending />;
  }

  if (user) {
    return <Navigate to="/notes" replace />;
  }

  return <Outlet />;
}
