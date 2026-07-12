import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  RefreshCw,
  SearchCheck,
  ServerCrash,
  ShieldAlert,
} from 'lucide-react';
import { listIncidents, type Incident } from '@/api/alerts';
import { listApprovals, type Approval } from '@/api/approvals';
import { listModels, type ModelCatalog } from '@/api/chat';
import { listEdges, type Edge } from '@/api/edges';
import { listReports, type ReportListItem } from '@/api/reports';
import { Button, Card, PageHeader } from '@/components/ui';
import { cn } from '@/lib/cn';
import { usePoll } from '@/lib/usePoll';

type PatrolHistoryItem = {
  id: string;
  deviceName?: string;
  generatedAt: string;
  summary: {
    total: number;
    pass: number;
    warn: number;
    fail: number;
    unknown: number;
  };
  archivedId?: string;
};

type PatrolSummary = PatrolHistoryItem['summary'];

type LoadState = {
  incidents: Incident[];
  approvals: Approval[];
  edges: Edge[];
  reports: ReportListItem[];
  models: ModelCatalog | null;
};

const REFRESH_MS = 60_000;
const PATROL_HISTORY_KEY = 'ongrid.securityPatrol.history.v1';
const EMPTY_PATROL_SUMMARY: PatrolSummary = { total: 0, pass: 0, warn: 0, fail: 0, unknown: 0 };

function normalizePatrolHistoryItem(item: unknown): PatrolHistoryItem | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  const summary = obj.summary && typeof obj.summary === 'object' ? (obj.summary as Record<string, unknown>) : {};
  const generatedAt = stringValue(obj.generatedAt) || stringValue(obj.generated_at);

  return {
    id: stringValue(obj.id) || generatedAt || String(Date.now()),
    deviceName: stringValue(obj.deviceName) || stringValue(obj.device_name) || undefined,
    generatedAt,
    archivedId: stringValue(obj.archivedId) || stringValue(obj.archived_id) || undefined,
    summary: {
      total: finiteNumber(summary.total),
      pass: finiteNumber(summary.pass),
      warn: finiteNumber(summary.warn),
      fail: finiteNumber(summary.fail),
      unknown: finiteNumber(summary.unknown),
    },
  };
}

function patrolSummaryOf(item?: PatrolHistoryItem): PatrolSummary {
  return item?.summary ?? EMPTY_PATROL_SUMMARY;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finiteNumber(value: unknown): number {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(num) ? num : 0;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<LoadState>({
    incidents: [],
    approvals: [],
    edges: [],
    reports: [],
    models: null,
  });
  const [patrolHistory, setPatrolHistory] = useState<PatrolHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadPatrolHistory = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(PATROL_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const items = Array.isArray(parsed)
        ? parsed.map(normalizePatrolHistoryItem).filter((it): it is PatrolHistoryItem => Boolean(it))
        : [];
      setPatrolHistory(items);
    } catch {
      setPatrolHistory([]);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    setError('');
    const failures: string[] = [];
    const [incidents, approvals, edges, reports, models] = await Promise.all([
      listIncidents({ status: 'open', pageSize: 50 }).catch((err) => {
        failures.push(`事件：${messageOf(err)}`);
        return null;
      }),
      listApprovals('pending').catch((err) => {
        failures.push(`人工确认：${messageOf(err)}`);
        return null;
      }),
      listEdges().catch((err) => {
        failures.push(`Edge：${messageOf(err)}`);
        return null;
      }),
      listReports({ status: 'ready', limit: 30 }).catch((err) => {
        failures.push(`报告：${messageOf(err)}`);
        return null;
      }),
      listModels().catch(() => null),
    ]);
    setData((prev) => ({
      incidents: incidents?.items ?? prev.incidents,
      approvals: approvals?.items ?? prev.approvals,
      edges: edges?.items ?? prev.edges,
      reports: reports?.reports ?? prev.reports,
      models: models ?? prev.models,
    }));
    loadPatrolHistory();
    setLastRefresh(new Date());
    setError(failures.length > 0 ? `部分数据加载失败：${failures.join('；')}` : '');
    setRefreshing(false);
    setLoading(false);
  }, [loadPatrolHistory]);

  useEffect(() => {
    loadPatrolHistory();
    void loadAll();
  }, [loadAll, loadPatrolHistory]);

  usePoll(loadAll, REFRESH_MS);

  const security = useMemo(() => {
    const pendingIncidents = data.incidents.filter((it) => it.status !== 'resolved');
    const criticalIncidents = pendingIncidents.filter((it) => it.severity === 'critical');
    const pendingApprovals = data.approvals.filter((it) => it.status === 'pending');
    const abnormalEdges = data.edges.filter((it) => it.status !== 'online');
    const latestPatrol = patrolHistory[0];
    const latestPatrolSummary = patrolSummaryOf(latestPatrol);
    const patrolRisk = latestPatrolSummary.fail + latestPatrolSummary.warn;
    const recentRca = data.reports.filter((it) => /rca|根因|调查|incident/i.test(`${it.title} ${it.summary}`)).slice(0, 5);
    const recentPatrolReports = data.reports.filter((it) => /巡检|patrol|security/i.test(`${it.title} ${it.summary}`)).slice(0, 3);
    const llmReady = Boolean(data.models && data.models.providers?.length > 0);
    const defaultModel = data.models?.default;

    return {
      pendingIncidents,
      criticalIncidents,
      pendingApprovals,
      abnormalEdges,
      latestPatrol,
      latestPatrolSummary,
      patrolRisk,
      recentRca,
      recentPatrolReports,
      llmReady,
      defaultModel,
    };
  }, [data, patrolHistory]);

  return (
    <main className="anim-fade flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="安全运维态势"
        subtitle={`登录首页 · ${lastRefresh ? `上次刷新 ${relativeTimeClean(lastRefresh)}` : '等待首次刷新'}`}
        actions={
          <Button onClick={() => void loadAll()} variant="ghost" disabled={refreshing}>
            <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {error && (
          <Card className="mb-4 border-red-700/40 bg-red-900/20 text-sm text-red-300">
            {error}
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <PostureCard
            title="待处置事件"
            value={security.pendingIncidents.length}
            tone={security.criticalIncidents.length > 0 ? 'danger' : security.pendingIncidents.length > 0 ? 'warn' : 'ok'}
            icon={ShieldAlert}
            hint={security.criticalIncidents.length > 0 ? `${security.criticalIncidents.length} 个严重事件` : '未闭环事件入口'}
            loading={loading}
            onClick={() => navigate('/alerts/incidents?closure=not_closed')}
          />
          <PostureCard
            title="待确认动作"
            value={security.pendingApprovals.length}
            tone={security.pendingApprovals.length > 0 ? 'warn' : 'ok'}
            icon={ClipboardCheck}
            hint="高风险建议动作需要人工确认"
            loading={loading}
            onClick={() => navigate('/approvals?status=pending')}
          />
          <PostureCard
            title="巡检风险"
            value={security.patrolRisk}
            tone={security.patrolRisk > 0 ? 'warn' : 'ok'}
            icon={SearchCheck}
            hint={security.latestPatrol ? `${security.latestPatrol.deviceName || '最近资产'} · ${relativeTimeClean(security.latestPatrol.generatedAt)}` : '尚无巡检历史'}
            loading={loading}
            onClick={() => navigate('/patrol')}
          />
          <PostureCard
            title="Edge 异常"
            value={security.abnormalEdges.length}
            tone={security.abnormalEdges.length > 0 ? 'danger' : 'ok'}
            icon={ServerCrash}
            hint={`${data.edges.filter((it) => it.status === 'online').length}/${data.edges.length} 在线`}
            loading={loading}
            onClick={() => navigate('/edges')}
          />
          <PostureCard
            title="LLM 可用性"
            value={security.llmReady ? '可用' : '未配置'}
            tone={security.llmReady ? 'ok' : 'warn'}
            icon={Bot}
            hint={security.defaultModel ? `${security.defaultModel.provider} / ${security.defaultModel.model}` : 'RCA 与报告依赖模型配置'}
            loading={loading}
            onClick={() => navigate('/settings/llm')}
          />
          <PostureCard
            title="最近 RCA"
            value={security.recentRca.length}
            tone={security.recentRca.length > 0 ? 'plain' : 'warn'}
            icon={FileText}
            hint="从事件调查生成或归档"
            loading={loading}
            onClick={() => navigate('/reports?kind=rca')}
          />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <Card>
            <SectionHeader title="当前优先处理" action="查看事件" onClick={() => navigate('/alerts/incidents')} />
            <div className="mt-3 space-y-2">
              {security.pendingIncidents.slice(0, 6).map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => navigate(`/alerts/incidents/${it.id}`)}
                  className="flex w-full items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-left hover:border-zinc-700"
                >
                  <SeverityDot severity={it.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-zinc-100">{it.rule_name || it.summary || `事件 #${it.id}`}</div>
                    <div className="mt-0.5 truncate text-xs text-zinc-500">
                      {it.target_name || it.target_id || '未定位资产'} · {relativeTimeClean(it.last_fired_at || it.fired_at)}
                    </div>
                  </div>
                  <ArrowRight size={14} className="text-zinc-500" />
                </button>
              ))}
              {!loading && security.pendingIncidents.length === 0 && (
                <EmptyLine icon={CheckCircle2} text="当前没有待处置事件。" />
              )}
            </div>
          </Card>

          <Card>
            <SectionHeader title="待确认动作" action="进入人工确认" onClick={() => navigate('/approvals?status=pending')} />
            <div className="mt-3 space-y-2">
              {security.pendingApprovals.slice(0, 5).map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => navigate('/approvals?status=pending')}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-left hover:border-zinc-700"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-zinc-100">{it.title || it.kind}</span>
                    <span className={cn('rounded px-1.5 py-0.5 text-[11px]', riskTone(inferApprovalRisk(it)))}>
                      {riskText(inferApprovalRisk(it))}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-zinc-500">{it.summary || it.source || '等待人工确认'}</div>
                </button>
              ))}
              {!loading && security.pendingApprovals.length === 0 && (
                <EmptyLine icon={CheckCircle2} text="没有待确认的高风险动作。" />
              )}
            </div>
          </Card>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <SectionHeader title="最近 RCA 报告" action="报告中心" onClick={() => navigate('/reports')} />
            <ReportList rows={security.recentRca} empty="还没有归档 RCA 报告。" onOpen={(id) => navigate(`/reports/${id}`)} />
          </Card>
          <Card>
            <SectionHeader title="巡检与报告" action="巡检中心" onClick={() => navigate('/patrol')} />
            <div className="mt-3 space-y-2">
              {security.latestPatrol && (
                <button
                  type="button"
                  onClick={() => navigate('/patrol')}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-left hover:border-zinc-700"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-100">{security.latestPatrol.deviceName || '最近巡检'}</span>
                    <span className="text-xs text-zinc-500">{relativeTimeClean(security.latestPatrol.generatedAt)}</span>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    通过 {security.latestPatrolSummary.pass}，警告 {security.latestPatrolSummary.warn}，失败 {security.latestPatrolSummary.fail}
                  </div>
                </button>
              )}
              <ReportList rows={security.recentPatrolReports} empty="还没有巡检报告归档。" onOpen={(id) => navigate(`/reports/${id}`)} compact />
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}

function PostureCard({
  title,
  value,
  hint,
  icon: Icon,
  tone,
  loading,
  onClick,
}: {
  title: string;
  value: number | string;
  hint: string;
  icon: typeof ShieldAlert;
  tone: 'ok' | 'warn' | 'danger' | 'plain';
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border bg-zinc-900/40 p-4 text-left transition hover:bg-zinc-900/70',
        toneClass(tone),
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-zinc-500">{title}</div>
          <div className={cn('mt-2 text-2xl font-semibold tabular-nums text-zinc-100', loading && 'animate-pulse text-zinc-600')}>
            {loading ? '-' : value}
          </div>
        </div>
        <span className="rounded-md border border-zinc-800 bg-zinc-950/40 p-2 text-zinc-300">
          <Icon size={18} />
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span className="truncate">{hint}</span>
        <ArrowRight size={13} className="shrink-0" />
      </div>
    </button>
  );
}

function SectionHeader({ title, action, onClick }: { title: string; action: string; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-medium text-zinc-100">{title}</h2>
      <Button variant="ghost" onClick={onClick}>
        {action}
        <ArrowRight size={13} />
      </Button>
    </div>
  );
}

function ReportList({
  rows,
  empty,
  compact,
  onOpen,
}: {
  rows: ReportListItem[];
  empty: string;
  compact?: boolean;
  onOpen: (id: string) => void;
}) {
  if (rows.length === 0) return <EmptyLine icon={FileText} text={empty} />;
  return (
    <div className="mt-3 space-y-2">
      {rows.slice(0, compact ? 3 : 5).map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onOpen(it.id)}
          className="w-full rounded-md border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-left hover:border-zinc-700"
        >
          <div className="truncate text-sm text-zinc-100">{it.title}</div>
          <div className="mt-0.5 truncate text-xs text-zinc-500">{it.summary || relativeTimeClean(it.generated_at || it.created_at)}</div>
        </button>
      ))}
    </div>
  );
}

function EmptyLine({ icon: Icon, text }: { icon: typeof CheckCircle2; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/30 px-3 py-3 text-sm text-zinc-500">
      <Icon size={15} />
      {text}
    </div>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const cls = severity === 'critical' ? 'bg-red-500' : severity === 'warning' ? 'bg-amber-400' : 'bg-sky-400';
  return <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', cls)} />;
}

function toneClass(tone: 'ok' | 'warn' | 'danger' | 'plain'): string {
  switch (tone) {
    case 'ok':
      return 'border-emerald-500/25 hover:border-emerald-400/50';
    case 'warn':
      return 'border-amber-500/25 hover:border-amber-400/50';
    case 'danger':
      return 'border-red-500/30 hover:border-red-400/60';
    default:
      return 'border-zinc-800 hover:border-zinc-700';
  }
}

function inferApprovalRisk(item: Approval): 'high' | 'medium' | 'low' {
  const text = `${item.kind} ${item.title} ${item.summary} ${item.payload}`.toLowerCase();
  if (/(delete|remove|shutdown|restart|apply|write|cloud_bash|高危|删除|重启|执行)/.test(text)) return 'high';
  if (/(mutate|update|install|change|修改|安装|变更)/.test(text)) return 'medium';
  return 'low';
}

function riskText(risk: 'high' | 'medium' | 'low'): string {
  return risk === 'high' ? '高风险' : risk === 'medium' ? '中风险' : '低风险';
}

function riskTone(risk: 'high' | 'medium' | 'low'): string {
  return risk === 'high'
    ? 'bg-red-900/30 text-red-300'
    : risk === 'medium'
      ? 'bg-amber-900/30 text-amber-300'
      : 'bg-zinc-800 text-zinc-300';
}

function relativeTimeClean(input: string | Date | undefined | null): string {
  if (!input) return '-';
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (!Number.isFinite(t)) return '-';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 5) return '刚刚';
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  return `${day} 天前`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
