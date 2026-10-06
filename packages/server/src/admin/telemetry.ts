import type { AdminCloudState, AdminServerStats, AdminServiceHealth, AdminToServerEvents, ServerToAdminEvents } from '@fmm/shared';
import type { Namespace } from 'socket.io';
import { CloudWatchReader } from './cloudWatch.js';
import { ServerStatsSampler } from './serverStats.js';
import { ServiceHealthChecker } from './serviceHealth.js';

/** One poller for every authorized console; nothing runs with zero open consoles. */
export function attachAdminTelemetry(adminIo: Namespace<AdminToServerEvents, ServerToAdminEvents>): void {
  const sampler = new ServerStatsSampler();
  const health = new ServiceHealthChecker();
  const cloud = new CloudWatchReader();
  const open = new Set<string>();
  let statsTimer: NodeJS.Timeout | null = null;
  let slowTimer: NodeJS.Timeout | null = null;
  let statsBusy = false;
  let slowBusy = false;
  let generation = 0;
  let latestStats: AdminServerStats | null = null;
  let latestHealth: AdminServiceHealth | null = null;
  let latestCloud: AdminCloudState | null = null;

  async function tickStats(active: number): Promise<void> {
    if (statsBusy || open.size === 0) return;
    statsBusy = true;
    try {
      const result = await sampler.sample();
      if (active === generation && open.size > 0) {
        latestStats = result;
        adminIo.emit('admin:stats', result);
      }
    } catch (error) { console.error('[admin stats] sample failed:', error); }
    finally { statsBusy = false; }
  }

  async function tickSlow(active: number): Promise<void> {
    if (slowBusy || open.size === 0) return;
    slowBusy = true;
    try {
      const [healthResult, cloudResult] = await Promise.allSettled([
        health.check(), cloud.read(), sampler.refreshRestarts(),
      ]);
      if (active !== generation || open.size === 0) return;
      if (healthResult.status === 'fulfilled') {
        latestHealth = healthResult.value;
        adminIo.emit('admin:health', latestHealth);
      }
      if (cloudResult.status === 'fulfilled') {
        latestCloud = cloudResult.value;
        adminIo.emit('admin:cloud', latestCloud);
      }
    } catch (error) { console.error('[admin stats] slow check failed:', error); }
    finally { slowBusy = false; }
  }

  async function start(): Promise<void> {
    const active = ++generation;
    try { await sampler.start(); }
    catch (error) { console.error('[admin stats] could not start sampler:', error); }
    if (active !== generation || open.size === 0) return;
    void tickStats(active);
    void tickSlow(active);
    statsTimer = setInterval(() => { void tickStats(active); }, 2000);
    slowTimer = setInterval(() => { void tickSlow(active); }, 60_000);
  }

  function stop(): void {
    generation++;
    if (statsTimer) clearInterval(statsTimer);
    if (slowTimer) clearInterval(slowTimer);
    statsTimer = null;
    slowTimer = null;
    sampler.stop();
    cloud.stop();
    statsBusy = false;
    slowBusy = false;
    latestStats = null;
    latestHealth = null;
    latestCloud = null;
  }

  // The namespace's existing access middleware has already approved these sockets.
  adminIo.on('connection', (socket) => {
    open.add(socket.id);
    if (latestStats) socket.emit('admin:stats', latestStats);
    if (latestHealth) socket.emit('admin:health', latestHealth);
    if (latestCloud) socket.emit('admin:cloud', latestCloud);
    if (open.size === 1) void start();
    socket.on('disconnect', () => {
      open.delete(socket.id);
      if (open.size === 0) stop();
    });
  });
}
