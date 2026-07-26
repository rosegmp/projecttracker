import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

const sentryAuthToken = String(process.env.SENTRY_AUTH_TOKEN || '').trim();
const sentryOrg = String(process.env.SENTRY_ORG || '').trim();
const sentryProject = String(process.env.SENTRY_PROJECT || '').trim();
const release = String(process.env.COMMIT_REF || process.env.GITHUB_SHA || 'project-tracker@0.1.0-local').trim();
const sentryUploadEnabled = Boolean(sentryAuthToken && sentryOrg && sentryProject);

export default defineConfig({
  build: {
    sourcemap: sentryUploadEnabled ? 'hidden' : false,
  },
  define: {
    __APP_RELEASE__: JSON.stringify(release),
  },
  plugins: [
    react(),
    sentryUploadEnabled
      ? sentryVitePlugin({
          authToken: sentryAuthToken,
          org: sentryOrg,
          project: sentryProject,
          release: {
            name: release,
            setCommits: {
              auto: true,
              ignoreMissing: true,
            },
          },
          sourcemaps: {
            assets: './dist/assets/**',
            filesToDeleteAfterUpload: ['./dist/**/*.map'],
          },
          telemetry: false,
        })
      : null,
  ].filter(Boolean),
});
