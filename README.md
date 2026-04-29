# Destiny Project Hub

This workspace now runs as a React/Vite web app for Destiny Project Hub.

## Files

- `src/App.jsx`: React app shell and native tracker screens
- `src/main.jsx`: React entry point
- `src/styles.css`: app styling
- `src/services/trackerData.js`: shared data layer for Supabase and local storage
- `.env.example`: example environment variables for local setup

## Run

1. `npm install`
2. Copy `.env.example` to `.env.local`
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY`
4. `npm run dev`

Then open the local Vite URL in your browser.

If you leave the Supabase vars blank, the app falls back to browser local storage.

## Build

1. `npm run build`
2. `npm run preview`
