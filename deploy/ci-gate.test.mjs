import { describe, expect, it } from 'vitest';
import { decideCiRun } from './ci-gate.mjs';

const sha = 'a'.repeat(40);
const run = (overrides = {}) => ({
  head_sha: sha,
  head_branch: 'main',
  event: 'push',
  path: '.github/workflows/ci.yml@main',
  status: 'completed',
  conclusion: 'success',
  updated_at: '2026-10-06T10:00:00Z',
  run_attempt: 1,
  ...overrides,
});

describe('CI deploy gate', () => {
  it('deploys only an exact successful main push', () => {
    expect(decideCiRun({ workflow_runs: [run()] }, sha)).toBe('deploy');
    expect(decideCiRun({ workflow_runs: [run({ event: 'pull_request' })] }, sha)).toBe('wait');
    expect(decideCiRun({ workflow_runs: [run({ head_branch: 'other' })] }, sha)).toBe('wait');
    expect(decideCiRun({ workflow_runs: [run({ head_sha: 'b'.repeat(40) })] }, sha)).toBe('wait');
    expect(decideCiRun({ workflow_runs: [run({ path: '.github/workflows/other.yml@main' })] }, sha)).toBe('wait');
  });

  it('waits when CI has not completed or the response is unusable', () => {
    expect(decideCiRun({ workflow_runs: [] }, sha)).toBe('wait');
    expect(decideCiRun({ workflow_runs: [run({ status: 'in_progress', conclusion: null })] }, sha)).toBe('wait');
    expect(decideCiRun({ workflow_runs: [run({ conclusion: null })] }, sha)).toBe('wait');
    expect(decideCiRun({ workflow_runs: [run()] }, 'not-a-sha')).toBe('wait');
    expect(decideCiRun({ message: 'rate limited' }, sha)).toBe('wait');
  });

  it('skips a completed unsuccessful run', () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required']) {
      expect(decideCiRun({ workflow_runs: [run({ conclusion })] }, sha)).toBe('skip');
    }
  });

  it('uses the latest attempt for the same commit', () => {
    const failed = run({ conclusion: 'failure', updated_at: '2026-10-06T10:00:00Z' });
    const retried = run({ run_attempt: 2, updated_at: '2026-10-06T10:05:00Z' });
    expect(decideCiRun({ workflow_runs: [failed, retried] }, sha)).toBe('deploy');
  });
});
