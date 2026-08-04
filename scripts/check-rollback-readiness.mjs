import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const EXPECTED_SITE_ID = 'f15655fa-bfab-410a-a475-693ca0add6ae';
const EXPECTED_PRODUCTION_URL = 'https://projecthub.destinyhomesnj.com';
const EXPECTED_REPOSITORY = 'rosegmp/projecttracker';

function fail(message) {
  throw new Error(message);
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    fail(`${label} returned invalid JSON.`);
  }
}

function isExpectedDeployPermalink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname.endsWith('--destinyprojecthub.netlify.app');
  } catch {
    return false;
  }
}

export function assessRollbackReadiness({ deploys, runs, branch, head }) {
  if (!Array.isArray(deploys) || !deploys.length) fail('No Netlify deploys were returned.');
  if (!Array.isArray(runs) || !runs.length) fail('No GitHub CI runs were returned.');
  const productionDeploys = deploys
    .filter((deploy) => (
      deploy.site_id === EXPECTED_SITE_ID
      && deploy.url === EXPECTED_PRODUCTION_URL
      && deploy.context === 'production'
      && deploy.branch === 'main'
      && deploy.state === 'ready'
      && deploy.published_at
    ))
    .sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at));
  if (productionDeploys.length < 2) fail('Two retained ready production deploys are required.');
  const current = productionDeploys[0];
  const candidate = productionDeploys.find((deploy) => deploy.commit_ref !== current.commit_ref);
  if (!candidate) fail('No distinct previous production deploy is retained.');
  if (!isExpectedDeployPermalink(candidate.links?.permalink)) {
    fail('Previous production deploy does not have an expected Netlify permalink.');
  }
  const latestRun = [...runs].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  )[0];
  if (latestRun.headSha !== head) fail('Latest GitHub CI run does not match local main HEAD.');
  return {
    current: {
      deployId: current.id,
      commit: current.commit_ref,
      permalink: current.links?.permalink,
    },
    candidate: {
      deployId: candidate.id,
      commit: candidate.commit_ref,
      permalink: candidate.links?.permalink,
    },
    latestCi: latestRun.conclusion || latestRun.status,
    mainProtected: Boolean(branch.protected),
    attention: [
      ...((latestRun.conclusion || latestRun.status) === 'success' ? [] : ['latest_ci_not_green']),
      ...(branch.protected ? [] : ['main_not_protected']),
      ...(current.commit_ref === head ? [] : ['production_deploy_behind_main']),
    ],
  };
}

async function run(command, args, options = {}) {
  let executable = command;
  let commandArgs = args;
  if (process.platform === 'win32' && command === 'netlify') {
    const netlifyEntry = join(
      process.env.APPDATA || '',
      'npm',
      'node_modules',
      'netlify-cli',
      'bin',
      'run.js',
    );
    if (!existsSync(netlifyEntry)) fail('Netlify CLI entry point was not found.');
    executable = process.execPath;
    commandArgs = [netlifyEntry, ...args];
  }
  const { stdout } = await execFileAsync(executable, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
  return stdout.trim();
}

async function checkHttp(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) fail('A rollback preflight URL did not return HTTP success.');
  return response.status;
}

async function main() {
  if (process.argv[2] !== '--live') {
    console.log('Usage: node scripts/check-rollback-readiness.mjs --live');
    return;
  }
  const status = await run('git', ['status', '--short']);
  if (status) fail('Working tree must be clean for a live rollback rehearsal.');
  const branchName = await run('git', ['branch', '--show-current']);
  if (branchName !== 'main') fail('Live rollback rehearsal requires main.');
  const head = await run('git', ['rev-parse', 'HEAD']);
  const netlifyData = JSON.stringify({
    site_id: EXPECTED_SITE_ID,
    production: true,
    state: 'ready',
    per_page: 20,
  });
  const [deployText, runText, branchText] = await Promise.all([
    run('netlify', ['api', 'listSiteDeploys', '--data', netlifyData], {
      env: { ...process.env, NODE_OPTIONS: '--use-system-ca' },
    }),
    run('gh', [
      'run', 'list', '--workflow', 'ci.yml', '--limit', '10',
      '--json', 'databaseId,headSha,status,conclusion,url,createdAt',
    ]),
    run('gh', ['api', `repos/${EXPECTED_REPOSITORY}/branches/main`]),
  ]);
  const result = assessRollbackReadiness({
    deploys: parseJson(deployText, 'Netlify CLI'),
    runs: parseJson(runText, 'GitHub CLI'),
    branch: parseJson(branchText, 'GitHub branch query'),
    head,
  });
  if (result.current.commit !== head) {
    try {
      await run('git', ['merge-base', '--is-ancestor', result.current.commit, head]);
    } catch {
      fail('Published Netlify commit is not an ancestor of local main HEAD.');
    }
  }
  const [productionStatus, candidateStatus] = await Promise.all([
    checkHttp(EXPECTED_PRODUCTION_URL),
    checkHttp(result.candidate.permalink),
  ]);
  console.log(
    `Rollback readiness checked: production_http=${productionStatus}, candidate_http=${candidateStatus}, latest_ci=${result.latestCi}, main_protected=${result.mainProtected}, attention=${result.attention.join(',') || 'none'}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Rollback readiness check failed. Provider response details were suppressed.');
    process.exitCode = 1;
  });
}
