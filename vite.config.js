import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

const sentryAuthToken = String(process.env.SENTRY_AUTH_TOKEN || '').trim();
const sentryOrg = String(process.env.SENTRY_ORG || '').trim();
const sentryProject = String(process.env.SENTRY_PROJECT || '').trim();
const sentryRepository = String(process.env.SENTRY_REPOSITORY || 'rosegmp/projecttracker').trim();
const release = String(process.env.COMMIT_REF || process.env.GITHUB_SHA || 'project-tracker@0.1.0-local').trim();
const previousRelease = String(process.env.CACHED_COMMIT_REF || '').trim();
const sentryUploadEnabled = Boolean(sentryAuthToken && sentryOrg && sentryProject);
const sentryEnvironment = String(process.env.VITE_SENTRY_ENVIRONMENT || '').trim().toLowerCase();
const deployContext = String(process.env.CONTEXT || '').trim().toLowerCase();
const deployUrl = String(process.env.DEPLOY_PRIME_URL || process.env.URL || '').trim();
const sentryDeployEnabled = Boolean(
  sentryUploadEnabled
    && sentryEnvironment
    && !release.endsWith('-local'),
);

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
            deploy: sentryDeployEnabled
              ? {
                  env: sentryEnvironment,
                  name: deployContext ? `netlify-${deployContext}` : 'trusted-build',
                  url: /^https:\/\//i.test(deployUrl) ? deployUrl : undefined,
                }
              : false,
            setCommits: {
              repo: sentryRepository,
              commit: release,
              previousCommit: previousRelease && previousRelease !== release ? previousRelease : undefined,
              ignoreMissing: true,
              ignoreEmpty: true,
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
