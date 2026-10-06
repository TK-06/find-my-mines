import { writeFileSync, renameSync } from 'node:fs';

const [, , file, sha, result, message, duration] = process.argv;
const durationMs = Number(duration);
if (!/^[a-f0-9]{40}$/.test(sha ?? '')
  || !['deployed', 'failed', 'skipped-ci-failed', 'rolled-back'].includes(result)
  || !Number.isFinite(durationMs) || durationMs < 0) {
  throw new Error('Invalid deployment status');
}

const status = {
  sha,
  shortSha: sha.slice(0, 7),
  at: Date.now(),
  result,
  message: String(message ?? '').slice(0, 200),
  durationMs,
};
const temporary = file + '.' + process.pid + '.tmp';
writeFileSync(temporary, JSON.stringify(status) + '\n', { mode: 0o600 });
renameSync(temporary, file);
