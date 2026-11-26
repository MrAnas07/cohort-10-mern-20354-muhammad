import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PasswordField from '../components/PasswordField';
import { useAuth } from '../context/AuthContext';
import { ApiError, fieldErrorsFrom } from '../lib/api';

// Mirrors the backend registerSchema (6.1): name 2-100 characters, a valid
// email, password 8-72 characters containing a letter and a number. These
// checks only save a round trip - the server validates and normalises again.
function validate({ fullName, email, password }) {
  const errors = {};
  if (fullName.trim().length < 2) {
    errors.fullName = 'Enter your full name (at least 2 characters)';
  }
  if (!email.trim()) {
    errors.email = 'Email is required';
  }
  if (password.length < 8) {
    errors.password = 'Password must be at least 8 characters';
  } else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.password = 'Password must contain at least one letter and one number';
  }
  return errors;
}

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');
    setFieldErrors({});

    const errors = validate({ fullName, email, password });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      await register({ fullName: fullName.trim(), email: email.trim(), password });
      // Architecture 7.3 #1: registering does not sign anyone in - hand off
      // to the login page with a confirmation notice.
      navigate('/login?registered=1', { replace: true });
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
      <h1 className="auth-title">Create your account</h1>
      {formError && (
        <p className="banner banner-error" role="alert">
          {formError}
        </p>
      )}
      <form className="form" noValidate onSubmit={handleSubmit}>
        <div className="field">
          <label className="label" htmlFor="register-name">
            Full name
          </label>
          <input
            className="input"
            id="register-name"
            name="fullName"
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            aria-invalid={fieldErrors.fullName ? 'true' : undefined}
            aria-describedby={fieldErrors.fullName ? 'register-name-error' : undefined}
          />
          {fieldErrors.fullName && (
            <p className="field-error" id="register-name-error">
              {fieldErrors.fullName}
            </p>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="register-email">
            Email
          </label>
          <input
            className="input"
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={fieldErrors.email ? 'true' : undefined}
            aria-describedby={fieldErrors.email ? 'register-email-error' : undefined}
          />
          {fieldErrors.email && (
            <p className="field-error" id="register-email-error">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <PasswordField
          id="register-password"
          label="Password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
        />
        <p className="hint">At least 8 characters, with one letter and one number.</p>

        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="auth-switch">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
