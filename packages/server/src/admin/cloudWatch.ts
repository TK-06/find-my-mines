import { CloudWatchClient, GetMetricStatisticsCommand, type Datapoint } from '@aws-sdk/client-cloudwatch';
import type { AdminCloudMetric, AdminCloudMetricName, AdminCloudState, AdminMetricPoint } from '@fmm/shared';

const METADATA = 'http://169.254.169.254/latest';
const PERIOD_SECONDS = 300;
const WINDOW_HOURS = 24;

interface InstanceIdentity { instanceId: string; region: string }
type Fetcher = typeof fetch;

export async function instanceIdentity(doFetch: Fetcher = fetch): Promise<InstanceIdentity | null> {
  try {
    const tokenResponse = await doFetch(`${METADATA}/api/token`, {
      method: 'PUT',
      headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '60' },
      signal: AbortSignal.timeout(300),
    });
    if (!tokenResponse.ok) return null;
    const token = await tokenResponse.text();
    if (!token) return null;
    const headers = { 'X-aws-ec2-metadata-token': token };
    const [instanceResponse, regionResponse] = await Promise.all([
      doFetch(`${METADATA}/meta-data/instance-id`, { headers, signal: AbortSignal.timeout(300) }),
      doFetch(`${METADATA}/meta-data/placement/region`, { headers, signal: AbortSignal.timeout(300) }),
    ]);
    if (!instanceResponse.ok || !regionResponse.ok) return null;
    const instanceId = (await instanceResponse.text()).trim();
    const region = (await regionResponse.text()).trim();
    if (!/^i-[a-f0-9]{8,17}$/.test(instanceId) || !/^[a-z]{2}-[a-z]+-\d$/.test(region)) return null;
    return { instanceId, region };
  } catch { return null; }
}

const METRICS: { name: AdminCloudMetricName; statistic: AdminCloudMetric['statistic']; unit: AdminCloudMetric['unit'] }[] = [
  { name: 'cpuUtilization', statistic: 'Average', unit: 'Percent' },
  { name: 'cpuCreditBalance', statistic: 'Average', unit: 'Count' },
  { name: 'cpuCreditUsage', statistic: 'Sum', unit: 'Count' },
  { name: 'networkIn', statistic: 'Sum', unit: 'Bytes' },
  { name: 'networkOut', statistic: 'Sum', unit: 'Bytes' },
  { name: 'statusCheckFailed', statistic: 'Maximum', unit: 'Count' },
];

const AWS_NAMES: Record<AdminCloudMetricName, string> = {
  cpuUtilization: 'CPUUtilization',
  cpuCreditBalance: 'CPUCreditBalance',
  cpuCreditUsage: 'CPUCreditUsage',
  networkIn: 'NetworkIn',
  networkOut: 'NetworkOut',
  statusCheckFailed: 'StatusCheckFailed',
};

/** CloudWatch explicitly does not promise chronological order. */
export function metricPoints(rows: Datapoint[], statistic: AdminCloudMetric['statistic']): AdminMetricPoint[] {
  return rows.flatMap((row) => {
    const value = row[statistic];
    const at = row.Timestamp?.getTime();
    return typeof value === 'number' && Number.isFinite(value) && typeof at === 'number' && Number.isFinite(at)
      ? [{ at, value }] : [];
  }).sort((a, b) => a.at - b.at);
}

function unavailable(reason: string, identity: InstanceIdentity | null = null): AdminCloudState {
  return { status: 'unavailable', reason, region: identity?.region ?? null,
    instanceId: identity?.instanceId ?? null, fetchedAt: null,
    periodSeconds: PERIOD_SECONDS, windowHours: WINDOW_HOURS, metrics: [] };
}

export function cloudErrorReason(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (/AccessDenied|Unauthorized/i.test(name)) return 'Role lacks cloudwatch:GetMetricStatistics';
  if (/CredentialsProviderError|UnrecognizedClient|InvalidClientTokenId/i.test(name)) return 'No IAM role attached';
  if (/Abort|Timeout/i.test(name)) return 'CloudWatch request timed out';
  return 'CloudWatch is unavailable';
}

export class CloudWatchReader {
  private identity: InstanceIdentity | null = null;
  private client: CloudWatchClient | null = null;

  stop(): void { this.client?.destroy(); this.client = null; }

  async read(): Promise<AdminCloudState> {
    if (process.platform !== 'linux') return unavailable('Not running on EC2');
    this.identity ??= await instanceIdentity();
    if (!this.identity) return unavailable('Not running on EC2 or instance metadata unavailable');
    const identity = this.identity;
    this.client ??= new CloudWatchClient({ region: identity.region, maxAttempts: 1 });
    const now = Date.now();
    const results = await Promise.allSettled(METRICS.map(async (metric): Promise<AdminCloudMetric> => {
      const response = await this.client!.send(new GetMetricStatisticsCommand({
        Namespace: 'AWS/EC2',
        MetricName: AWS_NAMES[metric.name],
        Dimensions: [{ Name: 'InstanceId', Value: identity.instanceId }],
        StartTime: new Date(now - WINDOW_HOURS * 3_600_000),
        EndTime: new Date(now),
        Period: PERIOD_SECONDS,
        Statistics: [metric.statistic],
      }), { abortSignal: AbortSignal.timeout(5000) });
      return { ...metric, points: metricPoints(response.Datapoints ?? [], metric.statistic) };
    }));
    const metrics = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    if (metrics.length === 0) {
      const first = results.find((result) => result.status === 'rejected');
      return unavailable(cloudErrorReason(first && first.status === 'rejected' ? first.reason : null), identity);
    }
    return {
      status: 'ready',
      reason: metrics.length < METRICS.length ? 'Some CloudWatch metrics are unavailable' : null,
      region: identity.region,
      instanceId: identity.instanceId,
      fetchedAt: Date.now(),
      periodSeconds: PERIOD_SECONDS,
      windowHours: WINDOW_HOURS,
      metrics,
    };
  }
}
