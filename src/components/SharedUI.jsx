import React from 'react';
import { reportError } from '../services/observability.js';

export function DashboardStat({ label, value, tone = 'default' }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export function PageStats({ settings, children }) {
  if (settings?.showPageStats === false) return null;
  return <div className="metrics-grid">{children}</div>;
}

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, supportId: '' };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    const { supportId } = reportError(error, {
      force: true,
      operation: 'application.render',
      workspace: this.props.resetKey,
    });
    this.setState({ supportId });
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, supportId: '' });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="error-banner" role="alert">
          <strong>Screen render failed.</strong>
          <span>Try this screen again. If the problem continues, share the support ID with an administrator.</span>
          {this.state.supportId ? <span>Support ID: {this.state.supportId}</span> : null}
          <button
            className="button secondary"
            type="button"
            onClick={() => this.setState({ hasError: false, supportId: '' })}
          >
            Try again
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}

export function WorkspaceSplash({ message }) {
  return (
    <main className="app-splash" aria-live="polite" aria-busy="true">
      <div className="app-splash-content">
        <div className="app-splash-logo" aria-hidden="true">
          <img src="/destiny-logo.png" alt="" />
        </div>
        <div className="app-splash-copy">
          <span>Destiny Homes</span>
          <h1>Project Hub</h1>
          <p>{message}</p>
        </div>
        <span className="app-splash-progress" aria-hidden="true" />
      </div>
    </main>
  );
}
