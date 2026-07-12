import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowLeft, FileText, Gauge, HardDrive, MemoryStick, RefreshCw, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import {
  getDevice,
  getDeviceObservabilityLogs,
  getDeviceObservabilityMetrics,
  type AssetMetricsResponse,
  type Device,
  type LokiStream,
} from '@/api/devices';
import type { PromMatrixSeries } from '@/api/edges';

type PanelKey = 'cpu' | 'mem' | 'disk';

type ChartRow = {
  ts: number;
  time: string;
  [series: string]: number | string;
};

type LogRow = {
  key: string;
  tsMs: number;
  time: string;
  labels: Record<string, string>;
  line: string;
};

const PANEL_META: Record<PanelKey, { title: string; icon: typeof Gauge; color: string; unit: string }> = {
  cpu: { title: 'CPU 使用率', icon: Gauge, color: '#60a5fa', unit: '%' },
  mem: { title: '内存使用率', icon: MemoryStick, color: '#34d399', unit: '%' },
  disk: { title: '磁盘使用率', icon: HardDrive, color: '#fbbf24', unit: '%' },
};

export default function AssetObservabilityPage() {
  const { deviceId = '' } = useParams<{ deviceId: string }>();
  const [device, setDevice] = useState<Device | null>(null);
  const [metrics, setMetrics] = useState<AssetMetricsResponse | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [logQuery, setLogQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!deviceId) return;
    setRefreshing(true);
    setError(null);
    const end = new Date();
    const start = new Date(end.getTime() - 6 * 60 * 60 * 1000);
    try {
      const [nextDevice, nextMetrics] = await Promise.all([
        getDevice(deviceId),
        getDeviceObservabilityMetrics(deviceId, {
          start: start.toISOString(),
          end: end.toISOString(),
          step: '1m',
        }),
      ]);
      setDevice(nextDevice);
      setMetrics(nextMetrics);
    } catch (err) {
      setError((err as Error).message || '加载观测数据失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [deviceId]);

  const refreshLogs = useCallback(async () => {
    if (!deviceId) return;
    setLogsError(null);
    const end = new Date();
    const start = new Date(end.getTime() - 60 * 60 * 1000);
    try {
      const resp = await getDeviceObservabilityLogs(deviceId, {
        start: start.toISOString(),
        end: end.toISOString(),
        limit: 200,
        filter: logQuery.trim(),
      });
      setLogs(streamsToRows(resp.result));
    } catch (err) {
      setLogs([]);
      setLogsError((err as Error).message || '查询日志失败');
    }
  }, [deviceId, logQuery]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void refreshLogs();
  }, [refreshLogs]);

  const panels = useMemo(() => {
    const out: Record<PanelKey, ReturnType<typeof matrixToChart>> = {
      cpu: { rows: [], series: [] },
      mem: { rows: [], series: [] },
      disk: { rows: [], series: [] },
    };
    if (!metrics) return out;
    (Object.keys(out) as PanelKey[]).forEach((key) => {
      out[key] = matrixToChart(metrics.panels[key]?.matrix ?? []);
    });
    return out;
  }, [metrics]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="border-b border-zinc-900 bg-zinc-950/95 px-6 py-4">
        <div className="mb-3">
          <Link
            to="/devices"
            className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100"
          >
            <ArrowLeft size={14} />
            返回资产
          </Link>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">资产观测映射</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {device?.name ?? `device #${deviceId}`} · 通过 Prometheus/Loki matcher 关联已有观测数据
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
            刷新
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-zinc-500">关联视图</span>
          <Link to={`/monitor?device=${encodeURIComponent(deviceId)}`} className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">指标查询</Link>
          <Link to={`/logs?device_id=${encodeURIComponent(deviceId)}`} className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">日志查询</Link>
          <Link to={`/topology?device_id=${encodeURIComponent(deviceId)}`} className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">网络拓扑</Link>
          <Link to={`/devices/${encodeURIComponent(deviceId)}/shell`} className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">WebShell</Link>
        </div>
      </div>

      <div className="space-y-5 px-6 py-5">
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="grid gap-3 lg:grid-cols-4">
          <InfoCard title="资产" value={device?.hostname || device?.name || '-'} hint={device?.online ? 'online' : 'offline / external'} />
          <InfoCard title="指标数据源" value={metrics?.datasource?.name ?? '未选择'} hint={metrics?.datasource?.type ?? 'Prometheus'} />
          <InfoCard title="PromQL matcher" value={metrics?.matcher ?? device?.metric_matcher ?? `device_id="${deviceId}"`} mono />
          <InfoCard title="日志 matcher" value={device?.log_matcher || `device_id="${deviceId}"`} mono />
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          {(Object.keys(PANEL_META) as PanelKey[]).map((key) => (
            <MetricPanel
              key={key}
              kind={key}
              rows={panels[key].rows}
              series={panels[key].series}
              error={metrics?.panels[key]?.error}
              loading={loading}
            />
          ))}
        </section>

        <section className="rounded-lg border border-zinc-900 bg-zinc-950">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-900 px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                <FileText size={15} />
                相关日志
              </div>
              <p className="mt-1 text-xs text-zinc-500">最近 1 小时，按资产 LogQL matcher 查询。</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={logQuery}
                onChange={(e) => setLogQuery(e.target.value)}
                placeholder='可选过滤，例如 |= "error"'
                className="w-64 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-600"
              />
              <button
                type="button"
                onClick={() => void refreshLogs()}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                <Search size={14} />
                查询
              </button>
            </div>
          </div>
          {logsError ? (
            <div className="px-4 py-6 text-sm text-red-300">{logsError}</div>
          ) : logs.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">暂无匹配日志</div>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-zinc-950 text-zinc-500">
                  <tr>
                    <th className="w-40 px-4 py-2 font-medium">时间</th>
                    <th className="w-72 px-4 py-2 font-medium">标签</th>
                    <th className="px-4 py-2 font-medium">内容</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  {logs.map((row) => (
                    <tr key={row.key} className="align-top hover:bg-zinc-900/40">
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-zinc-400">{row.time}</td>
                      <td className="px-4 py-2 font-mono text-zinc-500">{compactLabels(row.labels)}</td>
                      <td className="px-4 py-2 font-mono text-zinc-200">{row.line}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function InfoCard({
  title,
  value,
  hint,
  mono,
}: {
  title: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-zinc-950 px-4 py-3">
      <div className="text-xs text-zinc-500">{title}</div>
      <div className={cn('mt-2 truncate text-sm text-zinc-100', mono && 'font-mono')}>{value || '-'}</div>
      {hint && <div className="mt-1 truncate text-xs text-zinc-600">{hint}</div>}
    </div>
  );
}

function MetricPanel({
  kind,
  rows,
  series,
  error,
  loading,
}: {
  kind: PanelKey;
  rows: ChartRow[];
  series: string[];
  error?: string;
  loading: boolean;
}) {
  const meta = PANEL_META[kind];
  const Icon = meta.icon;
  return (
    <div className="rounded-lg border border-zinc-900 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-900 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon size={15} />
          {meta.title}
        </div>
        <span className="text-xs text-zinc-500">{meta.unit}</span>
      </div>
      <div className="h-64 px-2 py-3">
        {error ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-red-300">
            {error}
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">加载中...</div>
        ) : rows.length === 0 || series.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">暂无数据</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="time" stroke="#52525b" tick={{ fontSize: 10 }} minTickGap={28} />
              <YAxis stroke="#52525b" tick={{ fontSize: 10 }} width={34} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ background: '#09090b', border: '1px solid #27272a', borderRadius: 8 }}
                labelStyle={{ color: '#d4d4d8' }}
              />
              {series.map((name, idx) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={idx === 0 ? meta.color : palette(idx)}
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function matrixToChart(matrix: PromMatrixSeries[]) {
  const byTs = new Map<number, ChartRow>();
  const series: string[] = [];
  matrix.forEach((item, idx) => {
    const name = seriesName(item.metric, idx);
    series.push(name);
    (item.values ?? []).forEach(([ts, raw]) => {
      const tsMs = ts * 1000;
      const row = byTs.get(tsMs) ?? {
        ts: tsMs,
        time: new Date(tsMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      row[name] = Number.parseFloat(raw);
      byTs.set(tsMs, row);
    });
  });
  return { rows: [...byTs.values()].sort((a, b) => a.ts - b.ts), series };
}

function seriesName(metric: Record<string, string>, idx: number) {
  return (
    metric.cpu ||
    metric.mountpoint ||
    metric.device ||
    metric.instance ||
    metric.hostname ||
    metric.host ||
    metric.device_id ||
    `series_${idx + 1}`
  );
}

function streamsToRows(streams: LokiStream[]): LogRow[] {
  const rows: LogRow[] = [];
  streams.forEach((stream, sidx) => {
    (stream.values ?? []).forEach(([ns, line], lidx) => {
      const tsMs = Math.floor(Number(ns) / 1_000_000);
      rows.push({
        key: `${sidx}-${lidx}-${ns}`,
        tsMs,
        time: Number.isFinite(tsMs) ? new Date(tsMs).toLocaleString() : ns,
        labels: stream.stream ?? {},
        line,
      });
    });
  });
  return rows.sort((a, b) => b.tsMs - a.tsMs);
}

function compactLabels(labels: Record<string, string>) {
  const keys = ['host', 'hostname', 'instance', 'device_id', 'edge_id', 'job', 'app'];
  const picked = keys.filter((k) => labels[k]).map((k) => `${k}=${labels[k]}`);
  const out = picked.length > 0 ? picked : Object.entries(labels).slice(0, 4).map(([k, v]) => `${k}=${v}`);
  return out.join(' ');
}

function palette(idx: number) {
  const colors = ['#a78bfa', '#f87171', '#22d3ee', '#fb7185', '#4ade80', '#facc15'];
  return colors[idx % colors.length];
}
