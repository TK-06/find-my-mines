import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { AdminDeployStatus, AdminServerStats } from '@fmm/shared';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

type CpuTimes = Pick<os.CpuInfo, 'times'>[];

export function cpuPercent(before: CpuTimes, after: CpuTimes): number | null {
  if (before.length === 0 || before.length !== after.length) return null;
  let busy = 0;
  let total = 0;
  for (let index = 0; index < after.length; index++) {
    const old = before[index]!.times;
    const next = after[index]!.times;
    const idleDelta = next.idle - old.idle;
    const totalDelta = next.user + next.nice + next.sys + next.idle + next.irq
      - old.user - old.nice - old.sys - old.idle - old.irq;
    if (totalDelta <= 0 || idleDelta < 0) return null;
    total += totalDelta;
    busy += totalDelta - idleDelta;
  }
  return total > 0 ? Math.min(100, Math.max(0, (busy / total) * 100)) : null;
}

/** Linux MemAvailable includes reclaimable cache; MemFree alone overstates use. */
export function availableBytesFromMeminfo(raw: string): number | null {
  const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(raw);
  return match ? Number(match[1]) * 1024 : null;
}

export function parseDeployStatus(raw: string): AdminDeployStatus | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    if (typeof row.sha !== 'string' || !/^[a-f0-9]{7,40}$/i.test(row.sha)) return null;
    if (!['deployed', 'failed', 'skipped-ci-failed', 'rolled-back'].includes(String(row.result))) return null;
    const at = typeof row.at === 'number' ? row.at : Date.parse(String(row.at));
    if (!Number.isFinite(at) || at <= 0) return null;
    if (typeof row.durationMs !== 'number' || !Number.isFinite(row.durationMs) || row.durationMs < 0) return null;
    return {
      sha: row.sha,
      at,
      result: row.result as AdminDeployStatus['result'],
      message: typeof row.message === 'string' ? row.message.slice(0, 200) : '',
      durationMs: row.durationMs,
    };
  } catch {
    return null;
  }
}

async function gitDirectory(): Promise<string | null> {
  const dotGit = path.join(ROOT, '.git');
  try {
    if ((await stat(dotGit)).isDirectory()) return dotGit;
    const content = await readFile(dotGit, 'utf8');
    const match = /^gitdir:\s*(.+)\s*$/m.exec(content);
    return match ? path.resolve(ROOT, match[1]!.trim()) : null;
  } catch {
    return null;
  }
}

export async function readGitCommit(): Promise<string | null> {
  const gitDir = await gitDirectory();
  if (!gitDir) return null;
  try {
    const head = (await readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim();
    if (/^[a-f0-9]{40}$/i.test(head)) return head.slice(0, 7);
    const ref = /^ref: (refs\/[a-zA-Z0-9/_-]+)$/.exec(head)?.[1];
    if (!ref) return null;
    let refRoot = gitDir;
    try { refRoot = path.resolve(gitDir, (await readFile(path.join(gitDir, 'commondir'), 'utf8')).trim()); }
    catch { /* An ordinary clone keeps refs beside HEAD. */ }
    try {
      return (await readFile(path.join(refRoot, ref), 'utf8')).trim().slice(0, 7);
    } catch {
      const packed = await readFile(path.join(refRoot, 'packed-refs'), 'utf8');
      return new RegExp(`^([a-f0-9]{40}) ${ref}$`, 'm').exec(packed)?.[1]?.slice(0, 7) ?? null;
    }
  } catch {
    return null;
  }
}

export async function systemdRestartCount(): Promise<number | null> {
  if (process.platform !== 'linux') return null;
  try {
    const { stdout } = await execFileAsync('systemctl', ['show', 'findmymines', '-p', 'NRestarts', '--value'], { timeout: 1000 });
    if (!stdout.trim()) return null;
    const count = Number(stdout.trim());
    return Number.isInteger(count) && count >= 0 ? count : null;
  } catch {
    return null;
  }
}

export class ServerStatsSampler {
  private histogram: IntervalHistogram | null = null;
  private previousCpu: CpuTimes | null = null;
  private version = 'unknown';
  private commit: string | null = null;
  private restarts: number | null = null;
  private identityLoaded = false;

  async start(): Promise<void> {
    this.previousCpu = os.cpus();
    this.histogram = monitorEventLoopDelay({ resolution: 10 });
    this.histogram.enable();
    if (!this.identityLoaded) {
      try {
        const packageJson = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')) as { version?: string };
        this.version = packageJson.version ?? 'unknown';
      } catch { this.version = 'unknown'; }
      this.commit = await readGitCommit();
      this.identityLoaded = true;
    }
    this.restarts = await systemdRestartCount();
  }

  stop(): void {
    this.histogram?.disable();
    this.histogram = null;
    this.previousCpu = null;
  }

  async refreshRestarts(): Promise<void> { this.restarts = await systemdRestartCount(); }

  async sample(): Promise<AdminServerStats> {
    const currentCpu = os.cpus();
    const cpu = this.previousCpu ? cpuPercent(this.previousCpu, currentCpu) : null;
    this.previousCpu = currentCpu;
    let available = os.freemem();
    if (process.platform === 'linux') {
      try { available = availableBytesFromMeminfo(await readFile('/proc/meminfo', 'utf8')) ?? available; }
      catch { /* os.freemem is the portable fallback. */ }
    }
    const memory = process.memoryUsage();
    const histogram = this.histogram;
    const p50 = histogram && histogram.count > 0 ? histogram.percentile(50) / 1e6 : null;
    const p99 = histogram && histogram.count > 0 ? histogram.percentile(99) / 1e6 : null;
    histogram?.reset();
    let lastDeploy: AdminDeployStatus | null = null;
    const statusFile = process.env.DEPLOY_STATUS_FILE;
    if (statusFile) {
      try { lastDeploy = parseDeployStatus(await readFile(statusFile, 'utf8')); }
      catch { /* No status file before v3.11. */ }
    }
    return {
      sampledAt: Date.now(),
      cpuPercent: cpu,
      cpuCores: currentCpu.length,
      memoryUsedBytes: Math.max(0, os.totalmem() - available),
      memoryTotalBytes: os.totalmem(),
      loadAverage: os.loadavg() as [number, number, number],
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      rssBytes: memory.rss,
      eventLoopP50Ms: p50,
      eventLoopP99Ms: p99,
      processUptimeMs: process.uptime() * 1000,
      machineUptimeMs: os.uptime() * 1000,
      systemdRestarts: this.restarts,
      version: this.version,
      commit: this.commit,
      lastDeploy,
    };
  }
}
