import { request } from './client';
import type { AssetProfile, PromMatrixSeries } from './edges';

export type DeviceRole = 'host' | 'discovered';

export type Device = {
  id: number;
  name: string;
  hostname?: string;
  description?: string;
  roles?: string[];
  scope?: DeviceRole;
  online?: boolean;
  last_seen_at?: string | null;
  created_at?: string;
  updated_at?: string;
  asset_profile?: AssetProfile;
  business_system?: string;
  environment?: string;
  region?: string;
  datacenter?: string;
  cloud_provider?: string;
  owner?: string;
  criticality?: string;
  security_level?: string;
  maintenance_window?: string;
  tags?: string[];
  asset_type?: string;
  collection_mode?: string;
  external_source?: string;
  external_ref?: string;
  metric_datasource_id?: number | null;
  metric_matcher?: string;
  log_datasource_id?: number | null;
  log_matcher?: string;
  node_id?: number | null;
};

export type AssetMetricPanel = {
  matrix: PromMatrixSeries[];
  error?: string;
};

export type AssetMetricsResponse = {
  matcher: string;
  datasource?: { id: number; name: string; type: string; builtin: boolean };
  panels: Record<'cpu' | 'mem' | 'disk', AssetMetricPanel>;
  from: string;
  to: string;
  step: string;
};

export type LokiStream = {
  stream: Record<string, string>;
  values: [string, string][];
};

export type AssetLogsResponse = {
  matcher: string;
  query: string;
  datasource?: { id: number; name: string; type: string; builtin: boolean };
  resultType: string;
  result: LokiStream[];
  from: string;
  to: string;
};

export function listDevices() {
  return request<{ items: Device[]; total: number }>('GET', '/devices');
}

export function getDevice(id: string | number) {
  return request<Device>('GET', `/devices/${encodeURIComponent(String(id))}`);
}

export function getDeviceObservabilityMetrics(
  id: string | number,
  params: { start: string; end: string; step?: string },
) {
  const qs = new URLSearchParams({
    start: params.start,
    end: params.end,
    step: params.step ?? '1m',
  }).toString();
  return request<AssetMetricsResponse>(
    'GET',
    `/devices/${encodeURIComponent(String(id))}/observability/metrics?${qs}`,
  );
}

export function getDeviceObservabilityLogs(
  id: string | number,
  params: { start: string; end: string; limit?: number; filter?: string },
) {
  const qs = new URLSearchParams({
    start: params.start,
    end: params.end,
    limit: String(params.limit ?? 200),
  });
  if (params.filter) qs.set('filter', params.filter);
  return request<AssetLogsResponse>(
    'GET',
    `/devices/${encodeURIComponent(String(id))}/observability/logs?${qs.toString()}`,
  );
}
