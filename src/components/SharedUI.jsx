import React from 'react';

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
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'A screen failed to render.',
    };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: '' });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="error-banner">
          <strong>Screen render failed.</strong>
          <span>{this.state.message}</span>
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
