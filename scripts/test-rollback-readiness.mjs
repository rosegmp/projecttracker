import assert from 'node:assert/strict';
import test from 'node:test';
import { assessRollbackReadiness } from './check-rollback-readiness.mjs';

const head = 'a'.repeat(40);
const previous = 'b'.repeat(40);
const baseDeploy = {
  site_id: 'f15655fa-bfab-410a-a475-693ca0add6ae',
  url: 'https://projecthub.destinyhomesnj.com',
  context: 'production',
  branch: 'main',
  state: 'ready',
};

test('rollback readiness selects the current and distinct previous production deploy', () => {
  const result = assessRollbackReadiness({
    deploys: [
      {
        ...baseDeploy,
        id: 'current-deploy',
        commit_ref: head,
        published_at: '2026-08-04T12:00:00Z',
        links: { permalink: 'https://current--destinyprojecthub.netlify.app' },
      },
      {
        ...baseDeploy,
        id: 'previous-deploy',
        commit_ref: previous,
        published_at: '2026-08-03T12:00:00Z',
        links: { permalink: 'https://previous--destinyprojecthub.netlify.app' },
      },
    ],
    runs: [{ headSha: head, conclusion: 'success', createdAt: '2026-08-04T12:01:00Z' }],
    branch: { protected: true },
    head,
  });
  assert.equal(result.current.deployId, 'current-deploy');
  assert.equal(result.candidate.deployId, 'previous-deploy');
  assert.deepEqual(result.attention, []);
});

test('rollback readiness reports unprotected main and failed CI without selecting another site', () => {
  const result = assessRollbackReadiness({
    deploys: [
      {
        ...baseDeploy,
        id: 'current-deploy',
        commit_ref: head,
        published_at: '2026-08-04T12:00:00Z',
        links: { permalink: 'https://current--destinyprojecthub.netlify.app' },
      },
      {
        ...baseDeploy,
        id: 'previous-deploy',
        commit_ref: previous,
        published_at: '2026-08-03T12:00:00Z',
        links: { permalink: 'https://previous--destinyprojecthub.netlify.app' },
      },
      {
        ...baseDeploy,
        site_id: 'wrong-site',
        id: 'newer-wrong-site',
        commit_ref: 'c'.repeat(40),
        published_at: '2026-08-05T12:00:00Z',
      },
    ],
    runs: [{ headSha: head, conclusion: 'failure', createdAt: '2026-08-04T12:01:00Z' }],
    branch: { protected: false },
    head,
  });
  assert.equal(result.current.deployId, 'current-deploy');
  assert.deepEqual(result.attention, ['latest_ci_not_green', 'main_not_protected']);
});

test('rollback readiness reports when an earlier production deploy is still published', () => {
  const result = assessRollbackReadiness({
    deploys: [
      {
        ...baseDeploy,
        id: 'current-deploy',
        commit_ref: previous,
        published_at: '2026-08-04T12:00:00Z',
        links: { permalink: 'https://current--destinyprojecthub.netlify.app' },
      },
      {
        ...baseDeploy,
        id: 'older-deploy',
        commit_ref: 'c'.repeat(40),
        published_at: '2026-08-03T12:00:00Z',
        links: { permalink: 'https://previous--destinyprojecthub.netlify.app' },
      },
    ],
    runs: [{ headSha: head, conclusion: 'success', createdAt: '2026-08-04T12:01:00Z' }],
    branch: { protected: true },
    head,
  });
  assert.deepEqual(result.attention, ['production_deploy_behind_main']);
});

test('rollback readiness rejects an unexpected candidate URL', () => {
  assert.throws(() => assessRollbackReadiness({
    deploys: [
      {
        ...baseDeploy,
        id: 'current-deploy',
        commit_ref: head,
        published_at: '2026-08-04T12:00:00Z',
      },
      {
        ...baseDeploy,
        id: 'previous-deploy',
        commit_ref: previous,
        published_at: '2026-08-03T12:00:00Z',
        links: { permalink: 'https://unexpected.example.test' },
      },
    ],
    runs: [{ headSha: head, conclusion: 'success', createdAt: '2026-08-04T12:01:00Z' }],
    branch: { protected: true },
    head,
  }), /expected Netlify permalink/);
});
