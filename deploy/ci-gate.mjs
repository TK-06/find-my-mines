import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[a-f0-9]{40}$/i;
const CI_PATH = '.github/workflows/ci.yml';

/** Decide from the CI workflow's push runs for one exact main-branch commit. */
export function decideCiRun(payload, sha) {
  if (!SHA.test(sha) || !payload || !Array.isArray(payload.workflow_runs)) return 'wait';

  const runs = payload.workflow_runs
    .filter((run) => run
      && run.head_sha === sha
      && run.head_branch === 'main'
      && run.event === 'push'
      && typeof run.path === 'string'
      && (run.path === CI_PATH || run.path.startsWith(`${CI_PATH}@`)))
    .sort((a, b) => {
      const time = Date.parse(b.updated_at ?? '') - Date.parse(a.updated_at ?? '');
      if (Number.isFinite(time) && time !== 0) return time;
      return (Number(b.run_attempt) || 0) - (Number(a.run_attempt) || 0);
    });

  const latest = runs[0];
  if (!latest || latest.status !== 'completed' || !latest.conclusion) return 'wait';
  return latest.conclusion === 'success' ? 'deploy' : 'skip';
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const [, , file, sha] = process.argv;
    const decision = decideCiRun(JSON.parse(readFileSync(file, 'utf8')), sha);
    process.stdout.write(decision + '\n');
  } catch (error) {
    process.stderr.write('Cannot read CI result: ' + String(error) + '\n');
    process.exitCode = 1;
  }
}
