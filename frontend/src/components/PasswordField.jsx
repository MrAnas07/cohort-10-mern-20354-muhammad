import { useState } from 'react';

// Labeled password input with a show/hide toggle (Phase 07 UX list). Error
// text is wired to the input through aria-describedby for screen readers.
export default function PasswordField({ id, label, value, onChange, error, autoComplete }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="input-with-action">
        <input
          className="input"
          id={id}
          name={id}
          type={revealed ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button
          className="btn btn-quiet btn-inline"
          type="button"
          onClick={() => setRevealed((current) => !current)}
        >
          {revealed ? 'Hide' : 'Show'}
        </button>
      </div>
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
