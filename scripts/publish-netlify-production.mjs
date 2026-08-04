import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SITE_ID = 'f15655fa-bfab-410a-a475-693ca0add6ae';
const PRODUCTION_URL = 'https://projecthub.destinyhomesnj.com';
const DEPLOY_HOST_SUFFIX = '--destinyprojecthub.netlify.app';
const API_ROOT = 'https://api.netlify.com/api/v1';
const POLL_ATTEMPTS = 40;
const POLL_INTERVAL_MS = 15_000;

function fail(message) {
  throw new Error(message);
}

function validDeployUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith(DEPLOY_HOST_SUFFIX);
  } catch {
    return false;
  }
}

function fixedProductionDeploy(deploy) {
  return deploy?.site_id === SITE_ID
    && deploy.url === PRODUCTION_URL
    && deploy.context === 'production'
    && deploy.branch === 'main';
}

function newest(deploys, field) {
  return [...deploys].sort(
    (left, right) => Date.parse(right[field] || 0) - Date.parse(left[field] || 0),
  )[0];
}

export function selectReadyDeploy(deploys, expectedSha) {
  if (!Array.isArray(deploys)) fail('Netlify deploy inventory was not an array.');
  const deploy = newest(deploys.filter((entry) => (
    fixedProductionDeploy(entry)
    && entry.commit_ref === expectedSha
    && entry.state === 'ready'
    && entry.skipped !== true
  )), 'created_at');
  if (!deploy) return null;
  if (!/^[a-f0-9]{24}$/i.test(deploy.id || '')) fail('Ready deploy id is invalid.');
  if (!validDeployUrl(deploy.deploy_ssl_url)) fail('Ready deploy URL is outside the fixed Netlify site.');
  return deploy;
}

export function selectPublishedDeploy(deploys) {
  if (!Array.isArray(deploys)) fail('Netlify deploy inventory was not an array.');
  const deploy = newest(deploys.filter((entry) => (
    fixedProductionDeploy(entry)
    && entry.state === 'ready'
    && entry.published_at
  )), 'published_at');
  if (!deploy) fail('No published production deploy was returned.');
  if (!/^[a-f0-9]{24}$/i.test(deploy.id || '')) fail('Published deploy id is invalid.');
  return deploy;
}

async function apiRequest(path, { method = 'GET', label }) {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!token) fail('NETLIFY_AUTH_TOKEN is not configured.');
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    fail(`${label} could not reach Netlify.`);
  }
  if (!response.ok) fail(`${label} failed with HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    fail(`${label} returned invalid JSON.`);
  }
}

async function listDeploys({ latestPublished = false } = {}) {
  const query = new URLSearchParams({
    production: 'true',
    branch: 'main',
    per_page: '50',
  });
  if (latestPublished) query.set('latest-published', 'true');
  return apiRequest(`/sites/${SITE_ID}/deploys?${query}`, {
    label: 'Netlify deploy inventory',
  });
}

async function lockDeploy(deployId) {
  const locked = await apiRequest(`/deploys/${deployId}/lock`, {
    method: 'POST',
    label: 'Netlify deploy lock',
  });
  if (locked.id !== deployId || locked.site_id !== SITE_ID || locked.locked !== true) {
    fail('Netlify did not confirm the fixed deploy lock.');
  }
  return locked;
}

export async function retryOperation(operation, { attempts = 5, delayMs = 10_000 } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1) fail('Retry attempts must be a positive integer.');
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1 && delayMs > 0) {
        await new Promise((accept) => setTimeout(accept, delayMs));
      }
    }
  }
  throw lastError;
}

async function checkHttp(url, label) {
  return retryOperation(async () => {
    let response;
    try {
      response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      fail(`${label} HTTP check failed.`);
    }
    if (!response.ok) fail(`${label} returned HTTP ${response.status}.`);
    return response.status;
  });
}

async function waitForReadyDeploy(expectedSha) {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const deploys = await listDeploys();
    const candidate = selectReadyDeploy(deploys, expectedSha);
    if (candidate) return candidate;
    const failed = deploys.find((deploy) => (
      fixedProductionDeploy(deploy)
      && deploy.commit_ref === expectedSha
      && ['error', 'rejected'].includes(deploy.state)
    ));
    if (failed) fail('The tested commit has a failed Netlify deploy.');
    if (attempt < POLL_ATTEMPTS - 1) {
      await new Promise((accept) => setTimeout(accept, POLL_INTERVAL_MS));
    }
  }
  fail('Timed out waiting for the tested Netlify deploy.');
}

async function publishTestedCommit() {
  const expectedSha = process.env.EXPECTED_SHA || '';
  if (!/^[a-f0-9]{40}$/i.test(expectedSha)) fail('EXPECTED_SHA must be a full Git commit hash.');
  const candidate = await waitForReadyDeploy(expectedSha);
  const current = selectPublishedDeploy(await listDeploys({ latestPublished: true }));
  if (current.id !== candidate.id) {
    const restored = await apiRequest(`/sites/${SITE_ID}/deploys/${candidate.id}/restore`, {
      method: 'POST',
      label: 'Netlify tested deploy publish',
    });
    if (restored.id !== candidate.id || restored.site_id !== SITE_ID || restored.commit_ref !== expectedSha) {
      fail('Netlify did not confirm the tested deploy publish.');
    }
  }
  await lockDeploy(candidate.id);
  const [productionStatus, deployStatus] = await Promise.all([
    checkHttp(PRODUCTION_URL, 'Production site'),
    checkHttp(candidate.deploy_ssl_url, 'Tested deploy'),
  ]);
  const published = selectPublishedDeploy(await listDeploys({ latestPublished: true }));
  if (published.id !== candidate.id || published.commit_ref !== expectedSha || published.locked !== true) {
    fail('Published Netlify state does not match the tested locked deploy.');
  }
  console.log(
    `Published tested commit ${expectedSha.slice(0, 12)}: production_http=${productionStatus}, deploy_http=${deployStatus}, locked=true.`,
  );
}

async function lockCurrentProduction() {
  const current = selectPublishedDeploy(await listDeploys({ latestPublished: true }));
  await lockDeploy(current.id);
  const status = await checkHttp(PRODUCTION_URL, 'Production site');
  console.log(`Locked current production deploy: production_http=${status}, locked=true.`);
}

async function main() {
  if (process.argv[2] === '--live') {
    await publishTestedCommit();
    return;
  }
  if (process.argv[2] === '--lock-current') {
    await lockCurrentProduction();
    return;
  }
  console.log('Usage: node scripts/publish-netlify-production.mjs --live|--lock-current');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Netlify production publish failed.');
    process.exitCode = 1;
  });
}
