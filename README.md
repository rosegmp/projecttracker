# Project Hub

This workspace runs as a React/Vite web app for Project Hub.

The Project Hub Home dashboard offers a Map/List toggle for active project locations. Map uses OpenFreeMap with Leaflet. Project addresses are geocoded with the public OpenStreetMap Nominatim service and cached in the browser so repeat visits do not look them up again. Requests are spaced at least 1.15 seconds apart. Orange pins indicate approximate street locations when no house-level match is available. Neither map tiles nor address pins require an API key. Nominatim's public service is suitable only for modest traffic; a dedicated geocoding service or shared server cache is needed if usage grows.

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

## Executive briefing API

The read-only JSON API and MCP server are documented in [docs/projecthub-read-api.md](docs/projecthub-read-api.md). They use a dedicated service-account credential and do not reuse website login sessions.
