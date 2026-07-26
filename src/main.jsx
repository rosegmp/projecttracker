import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { initializeObservability, reportError } from './services/observability.js';
import './design-tokens.css';
import './styles.css';

function runTemporaryStagingValidation(observabilityReady) {
  const requested =
    import.meta.env.VITE_SENTRY_ENVIRONMENT === 'staging' &&
    new URLSearchParams(window.location.search).get('observability-test') === 'sanitized';
  if (!observabilityReady || !requested) return;

  const validationError = new Error(
    'Intentional staging validation for private@example.com at 105 Destiny Way in Private Customer Project.',
  );
  validationError.name = 'StagingValidationError';
  const { reported, supportId } = reportError(validationError, {
    force: true,
    operation: 'startup.bootstrap',
    workspace: 'settings',
  });

  const notice = document.createElement('aside');
  notice.setAttribute('role', 'status');
  notice.style.cssText =
    'position:fixed;z-index:9999;right:16px;bottom:16px;max-width:420px;padding:12px 16px;border-radius:8px;background:#123047;color:white;font:14px/1.4 system-ui;box-shadow:0 4px 18px #0004';
  notice.textContent = reported
    ? `Staging observability test sent. Support ID: ${supportId}`
    : 'Staging observability test was not sent. Confirm the Deploy Preview Sentry variables.';
  document.body.appendChild(notice);
}

async function startApplication() {
  const observabilityReady = await initializeObservability();
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  runTemporaryStagingValidation(observabilityReady);
}

void startApplication();
