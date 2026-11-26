import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import PasswordField from '../components/PasswordField';
import { useAuth } from '../context/AuthContext';
import { ApiError, fieldErrorsFrom } from '../lib/api';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Send people back where they were headed before bouncing to login.
  const from = location.state && location.state.from ? location.state.from : '/notes';
  const justRegistered = searchParams.get('registered') === '1';

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');
    setFieldErrors({});

    // Cheap client-side checks; the server remains the source of truth.
    const errors = {};
    if (!email.trim()) {
      errors.email = 'Email is required';
    }
    if (!password) {
      errors.password = 'Password is required';
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      await login({ email: email.trim(), password });
      navigate(from, { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        const details = fieldErrorsFrom(error);
        if (Object.keys(details).length > 0) {
          setFieldErrors(details);
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <h1 className="auth-title">Sign in</h1>
      {justRegistered && (
        <p className="banner banner-success" role="status">
          Account created. Sign in to continue.
        </p>
      )}
      {formError && (
        <p className="banner banner-error" role="alert">
          {formError}
        </p>
      )}
      <form className="form" noValidate onSubmit={handleSubmit}>
        <div className="field">
          <label className="label" htmlFor="login-email">
            Email
          </label>
          <input
            className="input"
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={fieldErrors.email ? 'true' : undefined}
            aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
          />
          {fieldErrors.email && (
            <p className="field-error" id="login-email-error">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <PasswordField
          id="login-password"
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
        />

        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="auth-switch">
        No account yet? <Link to="/register">Create one</Link>
      </p>
    </div>
  );
}
