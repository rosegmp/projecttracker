import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectPublishedDeploy,
  selectReadyDeploy,
} from './publish-netlify-production.mjs';

const siteId = 'f15655fa-bfab-410a-a475-693ca0add6ae';
const productionUrl = 'https://projecthub.destinyhomesnj.com';
const sha = 'a'.repeat(40);
const base = {
  site_id: siteId,
  url: productionUrl,
  context: 'production',
  branch: 'main',
  state: 'ready',
  skipped: false,
};

test('selects the newest ready deploy for the exact tested main commit', () => {
  const selected = selectReadyDeploy([
    {
      ...base,
      id: '1'.repeat(24),
      commit_ref: sha,
      created_at: '2026-08-04T10:00:00Z',
      deploy_ssl_url: 'https://old--destinyprojecthub.netlify.app',
    },
    {
      ...base,
      id: '2'.repeat(24),
      commit_ref: sha,
      created_at: '2026-08-04T11:00:00Z',
      deploy_ssl_url: 'https://new--destinyprojecthub.netlify.app',
    },
    {
      ...base,
      id: '3'.repeat(24),
      site_id: 'wrong-site',
      commit_ref: sha,
      created_at: '2026-08-04T12:00:00Z',
      deploy_ssl_url: 'https://wrong.example.test',
    },
  ], sha);
  assert.equal(selected.id, '2'.repeat(24));
});

test('returns null until the exact tested commit is ready', () => {
  assert.equal(selectReadyDeploy([{
    ...base,
    id: '1'.repeat(24),
    state: 'building',
    commit_ref: sha,
    created_at: '2026-08-04T10:00:00Z',
    deploy_ssl_url: 'https://building--destinyprojecthub.netlify.app',
  }], sha), null);
});

test('rejects a ready deploy URL outside the fixed site', () => {
  assert.throws(() => selectReadyDeploy([{
    ...base,
    id: '1'.repeat(24),
    commit_ref: sha,
    created_at: '2026-08-04T10:00:00Z',
    deploy_ssl_url: 'https://unexpected.example.test',
  }], sha), /outside the fixed Netlify site/);
});

test('selects the newest published production deploy', () => {
  const selected = selectPublishedDeploy([
    {
      ...base,
      id: '1'.repeat(24),
      commit_ref: 'b'.repeat(40),
      published_at: '2026-08-03T10:00:00Z',
    },
    {
      ...base,
      id: '2'.repeat(24),
      commit_ref: sha,
      published_at: '2026-08-04T10:00:00Z',
    },
  ]);
  assert.equal(selected.id, '2'.repeat(24));
});
