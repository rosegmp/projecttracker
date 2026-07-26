import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { initializeObservability } from './services/observability.js';
import './design-tokens.css';
import './styles.css';

async function startApplication() {
  await initializeObservability();
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void startApplication();
