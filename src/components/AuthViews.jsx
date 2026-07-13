import React, { useState } from 'react';

export function SignInView({ loading, recoveryLoading, error, recoveryMessage, onSignIn, onSendPasswordEmail }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(event) {
    event.preventDefault();
    onSignIn(email, password);
  }

  return (
    <main className="app-shell auth-shell">
      <section className="hero hero-compact">
        <div className="hero-copy auth-hero-copy">
          <div className="hero-brand">
            <div className="hero-logo" aria-hidden="true">
              <img src="/destiny-logo.png" alt="Destiny Homes logo" />
            </div>
            <h1>Destiny Project Hub</h1>
          </div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="panel-header">
          <div>
            <h2>Sign in</h2>
          </div>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              disabled={loading}
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              disabled={loading}
              required
            />
          </label>
          {error ? (
            <div className="error-banner compact">
              <strong>Sign-in failed.</strong>
              <span>{error}</span>
            </div>
          ) : null}
          {recoveryMessage ? (
            <div className={`auth-message${recoveryMessage.type === 'error' ? ' error' : ''}`}>
              {recoveryMessage.text}
            </div>
          ) : null}
          <button className="button primary" type="submit" disabled={loading || !email.trim() || !password}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
          <div className="auth-secondary-actions">
            <button
              className="button secondary"
              type="button"
              onClick={() => onSendPasswordEmail(email)}
              disabled={recoveryLoading || !email.trim()}
            >
              {recoveryLoading ? 'Sending...' : 'Forgot password'}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => onSendPasswordEmail(email)}
              disabled={recoveryLoading || !email.trim()}
            >
              {recoveryLoading ? 'Sending...' : 'Set password'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

export function PasswordResetView({ loading, error, onSavePassword, onSignOut }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const mismatch = password && confirmPassword && password !== confirmPassword;

  function handleSubmit(event) {
    event.preventDefault();
    if (password.length < 6 || mismatch) return;
    onSavePassword(password);
  }

  return (
    <main className="app-shell auth-shell">
      <section className="hero hero-compact">
        <div className="hero-copy auth-hero-copy">
          <div className="hero-brand">
            <div className="hero-logo" aria-hidden="true">
              <img src="/destiny-logo.png" alt="Destiny Homes logo" />
            </div>
            <h1>Destiny Project Hub</h1>
          </div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="panel-header">
          <div>
            <h2>Set password</h2>
          </div>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            <span>New password</span>
            <input
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
              disabled={loading}
              required
            />
          </label>
          <label>
            <span>Confirm password</span>
            <input
              type="password"
              value={confirmPassword}
              autoComplete="new-password"
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={loading}
              required
            />
          </label>
          {mismatch ? <div className="auth-message error">Passwords do not match.</div> : null}
          {error ? (
            <div className="error-banner compact">
              <strong>Password update failed.</strong>
              <span>{error}</span>
            </div>
          ) : null}
          <button
            className="button primary"
            type="submit"
            disabled={loading || password.length < 6 || password !== confirmPassword}
          >
            {loading ? 'Saving...' : 'Save password'}
          </button>
          <button className="button secondary" type="button" onClick={onSignOut} disabled={loading}>
            Back to sign in
          </button>
        </form>
      </section>
    </main>
  );
}

