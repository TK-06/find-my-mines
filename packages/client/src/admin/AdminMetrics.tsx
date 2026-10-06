import type { AdminCloudMetric, AdminCloudState, AdminMetricPoint, AdminServerStats, AdminServiceHealth } from '@fmm/shared';
import { useState, type PointerEvent } from 'react';
import './adminMetrics.css';

type Range = 1 | 6 | 24;

function bytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)} MiB`;
  return `${(value / 1024).toFixed(0)} KiB`;
}

function duration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days} d ${hours} h` : hours ? `${hours} h ${minutes} m` : `${minutes} m`;
}

function time(at: number): string {
  return new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function valueLabel(value: number, unit: AdminCloudMetric['unit']): string {
  if (unit === 'Bytes') return bytes(value);
  if (unit === 'Percent') return `${value.toFixed(1)}%`;
  return value.toFixed(value < 10 ? 2 : 1);
}

function Meter({ label, used, total }: { label: string; used: number; total: number }) {
  const percent = total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
  return (
    <div className="admin-metrics-meter">
      <div className="admin-metrics-meter-label"><span>{label}</span><strong>{bytes(used)} / {bytes(total)}</strong></div>
      <div className="admin-metrics-meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function ServerCard({ stats }: { stats: AdminServerStats | null }) {
  return (
    <div className="card admin-metrics-server">
      <div className="admin-metrics-card-head"><h3>Server</h3><span className="tag">every 2 s</span></div>
      {!stats ? <p className="muted admin-metrics-empty">Waiting for server readings…</p> : <>
        <div className="admin-metrics-primary">
          <span>CPU</span><strong>{stats.cpuPercent === null ? '—' : `${stats.cpuPercent.toFixed(0)}%`}</strong>
          <span className="muted">{stats.cpuCores} cores · load {stats.loadAverage.map((n) => n.toFixed(2)).join(' / ')}</span>
        </div>
        <div className="admin-metrics-meters">
          <Meter label="Machine memory" used={stats.memoryUsedBytes} total={stats.memoryTotalBytes} />
          <Meter label="Node heap" used={stats.heapUsedBytes} total={stats.heapTotalBytes} />
        </div>
        <dl className="admin-metrics-facts">
          <div><dt>Process RSS</dt><dd>{bytes(stats.rssBytes)}</dd></div>
          <div><dt>Event loop p50 / p99</dt><dd>{stats.eventLoopP50Ms === null ? '—' : `${stats.eventLoopP50Ms.toFixed(1)} / ${stats.eventLoopP99Ms?.toFixed(1) ?? '—'} ms`}</dd></div>
          <div><dt>App uptime</dt><dd>{duration(stats.processUptimeMs)}</dd></div>
          <div><dt>Machine uptime</dt><dd>{duration(stats.machineUptimeMs)}</dd></div>
          {stats.systemdRestarts !== null && <div><dt>Systemd restarts</dt><dd>{stats.systemdRestarts}</dd></div>}
          <div><dt>Build</dt><dd>v{stats.version}{stats.commit ? ` · ${stats.commit}` : ''}</dd></div>
        </dl>
        {stats.lastDeploy && <div className="admin-metrics-deploy">
          <strong>Last deploy</strong>
          <span>{stats.lastDeploy.result} · {time(stats.lastDeploy.at)} · {stats.lastDeploy.sha.slice(0, 7)}</span>
          {stats.lastDeploy.message && <small>{stats.lastDeploy.message}</small>}
        </div>}
        <p className="admin-metrics-footnote">Sampled {time(stats.sampledAt)} · Memory uses Linux MemAvailable when available.</p>
      </>}
    </div>
  );
}

const SERVICE_LABELS = { game: 'Game server', supabase: 'Supabase', groq: 'Groq', jev: 'JEV / TypeSafe' } as const;

function HealthCard({ health }: { health: AdminServiceHealth | null }) {
  return (
    <div className="card admin-metrics-health">
      <div className="admin-metrics-card-head"><h3>Service health</h3><span className="tag">every 1 min</span></div>
      <p className="muted admin-metrics-copy">Reachability from the game server. JEV checks its host only; no inference call is made.</p>
      {!health ? <p className="muted admin-metrics-empty">Waiting for service checks…</p> : <>
        <ul className="admin-metrics-services">
          {health.services.map((service) => (
            <li key={service.name}>
              <span className={`admin-metrics-dot ${service.status}`} aria-hidden="true" />
              <div><strong>{SERVICE_LABELS[service.name]}</strong><span className="muted">{service.status === 'not-configured' ? 'Optional service' : service.error ?? (service.latencyMs === null ? 'Reachable' : `${service.latencyMs} ms`)}{service.lastOkAt && service.status === 'down' ? ` · last OK ${time(service.lastOkAt)}` : ''}</span></div>
              <span className={`admin-metrics-service-state ${service.status}`}>{service.status === 'not-configured' ? 'Not configured' : service.status === 'ok' ? 'Reachable' : 'Unavailable'}</span>
            </li>
          ))}
        </ul>
        <p className="admin-metrics-footnote">Last checked {time(health.checkedAt)} · No external alerts</p>
      </>}
    </div>
  );
}

function metric(cloud: AdminCloudState, name: AdminCloudMetric['name']): AdminCloudMetric | null {
  return cloud.metrics.find((item) => item.name === name) ?? null;
}

function chartPath(points: AdminMetricPoint[], start: number, end: number, max: number, periodMs: number): string {
  let previousAt: number | null = null;
  return points.map((point) => {
    const x = 46 + ((point.at - start) / (end - start)) * 542;
    const y = 118 - (point.value / max) * 98;
    const command = previousAt === null || point.at - previousAt > periodMs * 1.5 ? 'M' : 'L';
    previousAt = point.at;
    return `${command}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
}

function MetricGraph({ title, series, range, end, periodSeconds, cloudUrl, fixedMax }:
  { title: string; series: { label: string; metric: AdminCloudMetric | null }[]; range: Range; end: number; periodSeconds: number; cloudUrl: string | null; fixedMax?: number }) {
  const [selectedAt, setSelectedAt] = useState<number | null>(null);
  const start = end - range * 3_600_000;
  const visible = series.map((item) => ({ ...item, points: item.metric?.points.filter((point) => point.at >= start && point.at <= end) ?? [] }));
  const all = visible.flatMap((item) => item.points);
  const timestamps = [...new Set(all.map((point) => point.at))].sort((a, b) => a - b);
  const maxValue = Math.max(fixedMax ?? 0, ...all.map((point) => point.value), 1);
  const scaleMax = fixedMax ?? maxValue * 1.1;
  const shownAt = selectedAt !== null && timestamps.includes(selectedAt) ? selectedAt : (timestamps.at(-1) ?? null);
  const latest = timestamps.at(-1) ?? null;
  const unit = series.find((item) => item.metric)?.metric?.unit ?? 'Count';
  const stat = series.find((item) => item.metric)?.metric?.statistic ?? 'Average';
  const formatTick = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  function pointAt(points: AdminMetricPoint[]): AdminMetricPoint | null {
    return points.find((point) => point.at === shownAt) ?? null;
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>): void {
    if (!timestamps.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * 600;
    const fraction = Math.min(1, Math.max(0, (svgX - 46) / 542));
    const target = start + fraction * (end - start);
    let nearest = timestamps[0]!;
    for (const at of timestamps) if (Math.abs(at - target) < Math.abs(nearest - target)) nearest = at;
    setSelectedAt(nearest);
  }

  return (
    <div className="admin-metrics-graph">
      <div className="admin-metrics-graph-head">
        <h4>{cloudUrl ? <a href={cloudUrl} target="_blank" rel="noopener noreferrer" title="Open CloudWatch metrics in the selected Region">{title} <span aria-hidden="true">↗</span></a> : title}</h4>
        <span>{stat} · {periodSeconds / 60} min · {unit}</span>
      </div>
      {all.length === 0 ? <p className="admin-metrics-graph-empty">No CloudWatch data in this range yet.</p> : <>
        <svg viewBox="0 0 600 150" preserveAspectRatio="none" role="img" aria-label={`${title}, ${range} hour graph, ${timestamps.length} time points`} onPointerMove={onPointerMove} onPointerLeave={() => setSelectedAt(null)}>
          {[20, 69, 118].map((y) => <line key={y} x1="46" x2="588" y1={y} y2={y} className="admin-metrics-gridline" />)}
          <text x="2" y="23" className="admin-metrics-axis-text">{valueLabel(scaleMax, unit)}</text>
          <text x="2" y="121" className="admin-metrics-axis-text">0</text>
          <text x="46" y="143" className="admin-metrics-axis-text">{formatTick(start)}</text>
          <text x="317" y="143" textAnchor="middle" className="admin-metrics-axis-text">{formatTick(start + (end - start) / 2)}</text>
          <text x="588" y="143" textAnchor="end" className="admin-metrics-axis-text">{formatTick(end)}</text>
          {visible.map((item, index) => <path key={item.label} d={chartPath(item.points, start, end, scaleMax, periodSeconds * 1000)} className={`admin-metrics-line line-${index}`} fill="none" />)}
          {selectedAt !== null && timestamps.includes(selectedAt) && <line x1={46 + ((selectedAt - start) / (end - start)) * 542} x2={46 + ((selectedAt - start) / (end - start)) * 542} y1="20" y2="118" className="admin-metrics-crosshair" />}
        </svg>
        <div className="admin-metrics-legend">
          {visible.map((item, index) => <span key={item.label}><i className={`line-${index}`} aria-hidden="true" />{item.label}: <strong>{pointAt(item.points) ? valueLabel(pointAt(item.points)!.value, item.metric?.unit ?? unit) : '—'}</strong></span>)}
        </div>
        <p className="admin-metrics-graph-detail">{shownAt ? `Reading ${time(shownAt)}` : 'No reading'} · {timestamps.length} points · {latest ? `latest ${time(latest)}` : 'no latest point'}</p>
      </>}
    </div>
  );
}

function CloudCard({ cloud }: { cloud: AdminCloudState | null }) {
  const [range, setRange] = useState<Range>(1);
  const url = cloud?.region ? `https://console.aws.amazon.com/cloudwatch/home?region=${encodeURIComponent(cloud.region)}#metricsV2:` : null;
  const end = cloud?.fetchedAt ?? Date.now();
  const status = cloud ? metric(cloud, 'statusCheckFailed')?.points.at(-1) : null;
  return (
    <div className="card admin-metrics-cloud">
      <div className="admin-metrics-card-head admin-metrics-cloud-head">
        <div><h3>AWS / CloudWatch</h3><p className="muted">{cloud?.instanceId && cloud.region ? `${cloud.instanceId} · ${cloud.region}` : 'EC2 instance metrics'}</p></div>
        <div className="admin-metrics-range" role="group" aria-label="Chart time range">
          {([1, 6, 24] as const).map((hours) => <button key={hours} className={`ghost small ${range === hours ? 'selected' : ''}`} type="button" aria-pressed={range === hours} onClick={() => setRange(hours)}>{hours}h</button>)}
        </div>
      </div>
      {!cloud ? <p className="muted admin-metrics-empty">Checking instance metadata and CloudWatch…</p>
        : cloud.status === 'unavailable' ? <p className="muted admin-metrics-empty">{cloud.reason}</p>
          : <>
            {cloud.reason && <p className="muted admin-metrics-partial">{cloud.reason}</p>}
            <div className="admin-metrics-graphs">
              <MetricGraph title="CPU utilization" series={[{ label: 'CPU', metric: metric(cloud, 'cpuUtilization') }]} range={range} end={end} periodSeconds={cloud.periodSeconds} cloudUrl={url} fixedMax={100} />
              <MetricGraph title="CPU credit balance" series={[{ label: 'Balance', metric: metric(cloud, 'cpuCreditBalance') }]} range={range} end={end} periodSeconds={cloud.periodSeconds} cloudUrl={url} />
              <MetricGraph title="CPU credits used" series={[{ label: 'Usage', metric: metric(cloud, 'cpuCreditUsage') }]} range={range} end={end} periodSeconds={cloud.periodSeconds} cloudUrl={url} />
              <MetricGraph title="Network traffic" series={[{ label: 'In', metric: metric(cloud, 'networkIn') }, { label: 'Out', metric: metric(cloud, 'networkOut') }]} range={range} end={end} periodSeconds={cloud.periodSeconds} cloudUrl={url} />
            </div>
            <div className="admin-metrics-cloud-foot"><span className={`admin-metrics-dot ${status?.value === 0 ? 'ok' : status ? 'down' : ''}`} aria-hidden="true" />Status checks: {status ? (status.value === 0 ? 'passing' : `failed (${status.value})`) : 'no recent data'}<span className="muted">· Data fetched {cloud.fetchedAt ? time(cloud.fetchedAt) : '—'} · 5-minute EC2 periods · Times in your browser's time zone</span></div>
          </>}
    </div>
  );
}

/** Adds observability without replacing the console's game and moderation tools. */
export function AdminMetrics({ stats, health, cloud }: { stats: AdminServerStats | null; health: AdminServiceHealth | null; cloud: AdminCloudState | null }) {
  return (
    <section className="admin-metrics" aria-label="Server monitoring">
      <div className="admin-metrics-section-head"><h2 className="section-title">Monitor</h2><p className="muted">Readings update only while an admin console is open.</p></div>
      <div className="admin-metrics-top"><ServerCard stats={stats} /><HealthCard health={health} /></div>
      <CloudCard cloud={cloud} />
    </section>
  );
}
