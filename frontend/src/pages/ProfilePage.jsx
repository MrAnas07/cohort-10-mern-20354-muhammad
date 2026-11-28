import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';

// Account overview for the signed-in user. GET /auth/me is re-read on mount
// so the page reflects the session as the server sees it (and can show its
// own loading/error states); the context user is only the first paint.

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(user);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [reload, setReload] = useState(0);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    api
      .get('/auth/me')
      .then((data) => {
        if (!cancelled) {
          setProfile(data.user);
          setStatus('ready');
        }
      })
      .catch(() => {
        // A 401 already cleared the user, so the guard redirects; anything
        // left here is a network or server fault worth retrying.
        if (!cancelled) {
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  async function handleSignOut() {
    setSigningOut(true);
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <section className="page">
      <h1 className="page-title">Profile</h1>
      <p className="page-lede">Your account details, as stored on the server.</p>

      {status === 'loading' && !profile && (
        <p className="route-loading" role="status">
          Loading profile…
        </p>
      )}

      {status === 'error' && (
        <div className="banner banner-error" role="alert">
          <p>Couldn’t load your profile. Check your connection and try again.</p>
          <button
            className="btn btn-inline"
            type="button"
            onClick={() => setReload((count) => count + 1)}
          >
            Try again
          </button>
        </div>
      )}

      {profile && (
        <div className="profile-card">
          <dl className="profile-list">
            <div className="profile-row">
              <dt>Name</dt>
              <dd>{profile.fullName}</dd>
            </div>
            <div className="profile-row">
              <dt>Email</dt>
              <dd>{profile.email}</dd>
            </div>
            <div className="profile-row">
              <dt>Member since</dt>
              <dd>{formatDate(profile.createdAt)}</dd>
            </div>
            <div className="profile-row">
              <dt>User ID</dt>
              <dd className="profile-id">{profile.id}</dd>
            </div>
          </dl>

          <div className="profile-actions">
            <button className="btn" type="button" onClick={handleSignOut} disabled={signingOut}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
