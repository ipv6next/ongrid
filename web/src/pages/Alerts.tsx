import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  GitBranch,
  ListTodo,
  RefreshCw,
  ShieldCheck,
  Siren,
  UserPlus,
  X,
} from 'lucide-react';
import { Modal } from '@/components/Modal';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { usePoll } from '@/lib/usePoll';
import {
  ackIncident,
  getIncidentInvestigation,
  listIncidents,
  localizedRuleName,
  resolveIncident,
  type Incident,
  type IncidentSeverity,
  type IncidentStatus,
  type InvestigationReport,
} from '@/api/alerts';
import { listApprovals, type Approval } from '@/api/approvals';
import { listEdges } from '@/api/edges';
import { listFlows, listFlowRuns, type Flow, type FlowRun } from '@/api/flows';
import { ApiError } from '@/api/client';
import { useIncidentBadge } from '@/store/incidentBadge';
import { usePermissions } from '@/store/me';
import { useI18n } from '@/i18n/locale';

const STATUS_FILTERS = [
  { key: '', zh: '全部', en: 'All' },
  { key: 'open', zh: '未确认', en: 'Open' },
  { key: 'acknowledged', zh: '已确认', en: 'Acknowledged' },
  { key: 'silenced', zh: '静默中', en: 'Silenced' },
  { key: 'resolved', zh: '已解决', en: 'Resolved' },
] as const;

const SEVERITY_FILTERS = [
  { key: '', zh: '全部', en: 'All' },
  { key: 'critical', zh: 'Critical', en: 'Critical' },
  { key: 'warning', zh: 'Warning', en: 'Warning' },
  { key: 'info', zh: 'Info', en: 'Info' },
] as const;

const RCA_FILTERS = [
  { key: '', zh: '全部', en: 'All' },
  { key: 'rca_ready', zh: 'RCA 已完成', en: 'RCA ready' },
  { key: 'rca_missing', zh: '未 RCA', en: 'No RCA' },
  { key: 'rca_running', zh: '调查中', en: 'Investigating' },
] as const;

const CONFIRM_FILTERS = [
  { key: '', zh: '全部', en: 'All' },
  { key: 'pending_approval', zh: '待确认', en: 'Pending approval' },
  { key: 'no_pending_approval', zh: '无需确认', en: 'No pending approval' },
] as const;

const REPORT_FILTERS = [
  { key: '', zh: '全部', en: 'All' },
  { key: 'reported', zh: '已报告', en: 'Reported' },
  { key: 'not_reported', zh: '未报告', en: 'No report' },
] as const;

const CLOSURE_FILTERS = [
  { key: '', zh: '全部', en: 'All' },
  { key: 'not_closed', zh: '未闭环', en: 'Not closed' },
  { key: 'closed', zh: '已闭环', en: 'Closed' },
] as const;

const POLL_INTERVAL_MS = 30_000;

function sourceLabel(source?: string) {
  switch (source) {
    case 'alertmanager_external':
      return '外部 Alertmanager';
    case 'manual_report':
      return '手工上报';
    case 'patrol_risk':
      return '巡检风险';
    case 'prometheus_external':
      return '外部 Prometheus';
    case 'ongrid_builtin':
    case '':
    case undefined:
      return 'Ongrid 内置规则';
    default:
      return source;
  }
}

type OpsFilter =
  | ''
  | 'rca_ready'
  | 'rca_missing'
  | 'rca_running'
  | 'pending_approval'
  | 'no_pending_approval'
  | 'reported'
  | 'not_reported'
  | 'not_closed'
  | 'closed';

type IncidentOpsMeta = {
  investigationStatus: InvestigationReport['status'] | 'unknown';
  confidence?: number | null;
  suggestedActionCount: number;
  pendingApprovalCount: number;
  approvalCount: number;
  latestApprovalStatus?: Approval['status'];
  workflowRunCount: number;
  latestWorkflowStatus?: FlowRun['status'];
  latestWorkflowName?: string;
  hasReport: boolean;
  lastAction: string;
};

export default function AlertsPage() {
  const { tr } = useI18n();
  const { canMutate } = usePermissions();
  const [items, setItems] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [rcaFilter, setRcaFilter] = useState<OpsFilter>('');
  const [confirmFilter, setConfirmFilter] = useState<OpsFilter>('');
  const [reportFilter, setReportFilter] = useState<OpsFilter>('');
  const [closureFilter, setClosureFilter] = useState<OpsFilter>('');
  const [resolving, setResolving] = useState<{ incident: Incident } | null>(null);
  const [ackBusyId, setAckBusyId] = useState<number | null>(null);
  const [deviceNames, setDeviceNames] = useState<Record<string, string>>({});
  const [opsMeta, setOpsMeta] = useState<Record<number, IncidentOpsMeta>>({});
  const [opsLoading, setOpsLoading] = useState(false);
  const globalOpen = useIncidentBadge((s) => s.openCount);
  const refreshBadge = useIncidentBadge((s) => s.refresh);

  const fetchIncidents = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      else setRefreshing(true);
      try {
        const r = await listIncidents({
          status: statusFilter || undefined,
          severity: severityFilter || undefined,
          pageSize: 100,
        });
        setItems(r.items ?? []);
        setErr(null);
        void refreshBadge();
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setErr(e instanceof ApiError ? e.message : (e as Error).message);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [statusFilter, severityFilter, refreshBadge],
  );

  useEffect(() => {
    let cancelled = false;
    listEdges()
      .then((r) => {
        if (cancelled) return;
        const m: Record<string, string> = {};
        for (const e of r.items ?? []) {
          if (e.device_id != null) m[String(e.device_id)] = e.name;
        }
        setDeviceNames(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void fetchIncidents();
  }, [fetchIncidents]);
  usePoll(() => fetchIncidents({ silent: true }), POLL_INTERVAL_MS);

  useEffect(() => {
    let cancelled = false;
    if (items.length === 0) {
      setOpsMeta({});
      return;
    }
    setOpsLoading(true);
    const load = async () => {
      const [approvalRes, investigationResults, workflowRows] = await Promise.all([
        listApprovals().catch(() => ({ items: [] as Approval[] })),
        Promise.allSettled(items.map((inc) => getIncidentInvestigation(inc.id))),
        loadWorkflowRuns().catch(() => [] as Array<{ flow: Flow; run: FlowRun }>),
      ]);
      if (cancelled) return;
      const next: Record<number, IncidentOpsMeta> = {};
      items.forEach((inc, index) => {
        const invResult = investigationResults[index];
        const report = invResult.status === 'fulfilled' ? invResult.value : null;
        const approvals = filterIncidentApprovals(approvalRes.items ?? [], inc.id, report?.audit_session_id);
        const runs = workflowRows.filter(({ run }) => triggerIncidentID(run.trigger) === inc.id);
        next[inc.id] = buildIncidentOpsMeta(inc, report, approvals, runs);
      });
      setOpsMeta(next);
      setOpsLoading(false);
    };
    void load().catch(() => {
      if (!cancelled) setOpsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [items]);

  const counts = useMemo(() => {
    let critical = 0;
    for (const i of items) if (i.severity === 'critical') critical++;
    return { total: items.length, critical };
  }, [items]);

  const filteredItems = useMemo(
    () =>
      items.filter((inc) =>
        matchesOpsFilters(inc, opsMeta[inc.id], {
          rcaFilter,
          confirmFilter,
          reportFilter,
          closureFilter,
        }),
      ),
    [items, opsMeta, rcaFilter, confirmFilter, reportFilter, closureFilter],
  );

  const opsCounts = useMemo(() => {
    let pendingApproval = 0;
    let missingRca = 0;
    let notClosed = 0;
    for (const inc of items) {
      const meta = opsMeta[inc.id];
      if (meta?.pendingApprovalCount) pendingApproval++;
      if (isMissingRca(meta)) missingRca++;
      if (!isClosedIncident(inc, meta)) notClosed++;
    }
    return { pendingApproval, missingRca, notClosed };
  }, [items, opsMeta]);

  return (
    <>
      <main className="anim-fade flex flex-1 flex-col overflow-hidden">
        <header className="app-header border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                {tr('事件', 'Incidents')}
                {globalOpen > 0 && (
                  <span className="inline-flex items-center rounded-full bg-red-500/90 px-2 py-0.5 text-[11px] font-medium text-white">
                    {globalOpen} {tr('未确认', 'open')}
                  </span>
                )}
              </h1>
              <p className="mt-0.5 text-xs text-zinc-500">
                {tr(
                  `全局 ${globalOpen} 未确认 · 当前 ${filteredItems.length}/${counts.total} 条 · 待确认 ${opsCounts.pendingApproval} · 未 RCA ${opsCounts.missingRca} · 未闭环 ${opsCounts.notClosed}`,
                  `${globalOpen} open globally · ${filteredItems.length}/${counts.total} shown · ${opsCounts.pendingApproval} pending approval · ${opsCounts.missingRca} without RCA · ${opsCounts.notClosed} not closed`,
                )}
                {opsLoading && <span className="ml-2 text-indigo-300">{tr('同步 RCA 状态中…', 'Syncing RCA status…')}</span>}
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                to="/alerts/rules"
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                <ListTodo size={12} /> {tr('规则配置', 'Rule config')}
              </Link>
              <button
                type="button"
                onClick={() => void fetchIncidents()}
                disabled={loading || refreshing}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                <RefreshCw size={12} className={cn(refreshing && 'animate-spin')} />
                {tr('刷新', 'Refresh')}
              </button>
            </div>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-6 py-3 text-xs text-zinc-400">
          <FilterGroup label={tr('状态', 'Status')} options={localizedOptions(STATUS_FILTERS, tr)} value={statusFilter} onChange={setStatusFilter} />
          <FilterGroup label={tr('级别', 'Severity')} options={localizedOptions(SEVERITY_FILTERS, tr)} value={severityFilter} onChange={setSeverityFilter} />
          <FilterGroup label="RCA" options={localizedOptions(RCA_FILTERS, tr)} value={rcaFilter} onChange={(v) => setRcaFilter(v as OpsFilter)} />
          <FilterGroup label={tr('确认', 'Approval')} options={localizedOptions(CONFIRM_FILTERS, tr)} value={confirmFilter} onChange={(v) => setConfirmFilter(v as OpsFilter)} />
          <FilterGroup label={tr('报告', 'Report')} options={localizedOptions(REPORT_FILTERS, tr)} value={reportFilter} onChange={(v) => setReportFilter(v as OpsFilter)} />
          <FilterGroup label={tr('闭环', 'Closure')} options={localizedOptions(CLOSURE_FILTERS, tr)} value={closureFilter} onChange={(v) => setClosureFilter(v as OpsFilter)} />
          {(rcaFilter || confirmFilter || reportFilter || closureFilter) && (
            <button
              type="button"
              onClick={() => {
                setRcaFilter('');
                setConfirmFilter('');
                setReportFilter('');
                setClosureFilter('');
              }}
              className="rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
            >
              {tr('清除运营筛选', 'Clear ops filters')}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {err && (
            <div className="m-6 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-300">
              {tr('加载失败：', 'Load failed: ')}{err}
            </div>
          )}
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-zinc-500">{tr('加载中…', 'Loading…')}</div>
          ) : filteredItems.length === 0 ? (
            <EmptyState />
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-950 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                <tr className="border-b border-zinc-800">
                  <th className="px-4 py-2 font-medium">{tr('级别', 'Severity')}</th>
                  <th className="px-4 py-2 font-medium">{tr('规则', 'Rule')}</th>
                  <th className="px-4 py-2 font-medium">{tr('摘要', 'Summary')}</th>
                  <th className="px-4 py-2 font-medium">{tr('目标', 'Target')}</th>
                  <th className="px-4 py-2 font-medium">{tr('状态', 'Status')}</th>
                  <th className="px-4 py-2 font-medium">RCA</th>
                  <th className="px-4 py-2 font-medium">{tr('确认/报告', 'Approval/Report')}</th>
                  <th className="px-4 py-2 font-medium">{tr('分派/SLA', 'Assign/SLA')}</th>
                  <th className="px-4 py-2 font-medium">{tr('最近动作', 'Latest action')}</th>
                  <th className="px-4 py-2 text-right font-medium">{tr('操作', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((inc) => (
                  <IncidentRow
                    key={inc.id}
                    incident={inc}
                    meta={opsMeta[inc.id]}
                    deviceNames={deviceNames}
                    ackBusy={ackBusyId === inc.id}
                    canMutate={canMutate}
                    onAck={async () => {
                      setAckBusyId(inc.id);
                      try {
                        await ackIncident(inc.id, '');
                        await Promise.all([fetchIncidents({ silent: true }), refreshBadge()]);
                      } catch (e) {
                        setErr(e instanceof ApiError ? e.message : (e as Error).message);
                      } finally {
                        setAckBusyId(null);
                      }
                    }}
                    onResolve={() => setResolving({ incident: inc })}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {resolving && (
        <ResolveDialog
          incident={resolving.incident}
          onClose={() => setResolving(null)}
          onDone={() => {
            setResolving(null);
            void fetchIncidents({ silent: true });
            void refreshBadge();
          }}
        />
      )}
    </>
  );
}

function IncidentRow({
  incident,
  meta,
  deviceNames,
  onAck,
  onResolve,
  ackBusy,
  canMutate,
}: {
  incident: Incident;
  meta?: IncidentOpsMeta;
  deviceNames: Record<string, string>;
  onAck(): void;
  onResolve(): void;
  ackBusy: boolean;
  canMutate: boolean;
}) {
  const { tr } = useI18n();
  const navigate = useNavigate();
  const viewerTip = canMutate ? undefined : tr('只读账号不能操作告警', 'Viewer accounts cannot act on alerts');
  const canAck = canMutate && incident.status === 'open' && !ackBusy;
  const canResolve = canMutate && incident.status !== 'resolved';
  const detailHref = `/alerts/incidents/${incident.id}`;
  const onRowClick = (e: React.MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as HTMLElement).closest('button, a, [data-stop-row-nav]')) return;
    navigate(detailHref);
  };

  return (
    <tr
      className={cn(
        'cursor-pointer border-b border-zinc-900 hover:bg-zinc-900/30',
        incident.status === 'open' && 'bg-red-500/[0.04]',
      )}
      onClick={onRowClick}
    >
      <td className={cn('whitespace-nowrap px-4 py-2.5', incident.status === 'open' && 'border-l-2 border-l-red-500/70')}>
        <SeverityBadge severity={incident.severity} />
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <Link to={detailHref} className="block hover:underline">
          <div className="font-medium text-zinc-100">{localizedRuleName(incident.rule_key, incident.rule_name || incident.rule_key)}</div>
          <div className="text-[11px] text-zinc-500">#{incident.id} · {incident.rule_key}</div>
        </Link>
      </td>
      <td className="w-full max-w-0 px-4 py-2.5 text-zinc-300">
        <div className="truncate" title={incident.summary}>{incident.summary}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
          <span>{tr('触发', 'fired')} {relativeTime(incident.fired_at)}</span>
          <span>·</span>
          <span>{tr('最近', 'last')} {relativeTime(incident.last_fired_at)}</span>
          <span>·</span>
          <span>{tr('次数', 'count')} {incident.event_count}</span>
          <span>·</span>
          <span>{sourceLabel(incident.source_type)}</span>
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-zinc-400">
        {incident.target_type === 'edge' && incident.target_id
          ? (deviceNames[incident.target_id] ? `${deviceNames[incident.target_id]} · #${incident.target_id}` : tr(`设备 ${incident.target_id}`, `Device ${incident.target_id}`))
          : incident.source_type === 'alertmanager_external'
            ? <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-300">待关联资产</span>
            : '-'}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <StatusBadge status={incident.status} />
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <RcaBadge meta={meta} />
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <div className="flex flex-col gap-1">
          <ApprovalBadge
            pendingCount={meta?.pendingApprovalCount ?? 0}
            total={meta?.approvalCount ?? 0}
            latestStatus={meta?.latestApprovalStatus}
          />
          <ReportBadge hasReport={Boolean(meta?.hasReport)} />
          <WorkflowBadge meta={meta} />
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <div className="flex flex-col gap-1 text-[11px] text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <UserPlus size={11} />
            {tr('未分派', 'Unassigned')}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 size={11} />
            {incident.severity === 'critical' ? 'SLA 30m' : incident.severity === 'warning' ? 'SLA 4h' : 'SLA 24h'}
          </span>
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-[12px] text-zinc-400">
        {meta?.lastAction ?? '-'}
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="inline-flex gap-1.5">
          <button
            type="button"
            onClick={onAck}
            disabled={!canAck}
            title={viewerTip}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
          >
            {ackBusy ? tr('处理中…', 'Working…') : 'Ack'}
          </button>
          <button
            type="button"
            onClick={onResolve}
            disabled={!canResolve}
            title={viewerTip}
            className="rounded-md border border-emerald-700/60 bg-emerald-900/20 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-40"
          >
            Resolve
          </button>
        </div>
      </td>
    </tr>
  );
}

function ResolveDialog({ incident, onClose, onDone }: { incident: Incident; onClose(): void; onDone(): void }) {
  const { tr } = useI18n();
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!note.trim()) {
      setErr(tr('请填写备注', 'Please add a note'));
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await resolveIncident(incident.id, note.trim());
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={tr('解决事件', 'Resolve incident')}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
            {tr('取消', 'Cancel')}
          </button>
          <button type="button" onClick={submit} disabled={submitting} className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-50">
            {submitting ? tr('提交中…', 'Submitting…') : tr('解决', 'Resolve')}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-400">
          <div className="text-zinc-200">{incident.summary || incident.rule_key}</div>
          <div className="mt-1 text-[11px] text-zinc-500">incident #{incident.id}</div>
        </div>
        <label className="block text-xs text-zinc-400">
          <span className="mb-1 block">{tr('备注（必填，进入 incident 时间线）', 'Note (required, recorded in the incident timeline)')}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={tr('例如：规则已调整，指标恢复正常', 'e.g. rule adjusted, metrics back to normal')}
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
        </label>
        {err && <div className="text-xs text-red-400">{err}</div>}
      </div>
    </Modal>
  );
}

function FilterGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: string; label: string }[];
  value: string;
  onChange(v: string): void;
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-zinc-500">{label}</span>
      <div className="flex gap-1">
        {options.map((opt) => (
          <button
            key={opt.key || '_all'}
            type="button"
            onClick={() => onChange(opt.key)}
            className={cn(
              'rounded-md border px-2 py-0.5 text-[11px] transition-colors',
              value === opt.key
                ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  const styles =
    severity === 'critical'
      ? 'bg-red-500/15 text-red-300 ring-red-500/40'
      : severity === 'warning'
        ? 'bg-amber-500/10 text-amber-300 ring-amber-500/30'
        : 'bg-zinc-800 text-zinc-300 ring-zinc-700';
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', styles)}>
      {severity === 'critical' ? <Siren size={11} /> : <AlertTriangle size={11} />}
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: IncidentStatus }) {
  const styles =
    status === 'open'
      ? 'bg-red-500/10 text-red-300 ring-red-500/30'
      : status === 'acknowledged'
        ? 'bg-blue-500/10 text-blue-300 ring-blue-500/30'
        : status === 'silenced'
          ? 'bg-zinc-700 text-zinc-300 ring-zinc-600'
          : 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30';
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', styles)}>
      {status === 'resolved' ? <CheckCircle2 size={11} /> : status === 'silenced' ? <X size={11} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {status}
    </span>
  );
}

function RcaBadge({ meta }: { meta?: IncidentOpsMeta }) {
  const { tr } = useI18n();
  if (!meta) {
    return <span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-500">{tr('同步中', 'Loading')}</span>;
  }
  const status = meta.investigationStatus;
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
        <ShieldCheck size={11} />
        RCA {meta.confidence != null ? `${Math.round(meta.confidence * 100)}%` : tr('已完成', 'ready')}
        {meta.suggestedActionCount > 0 && <span className="font-mono">· {meta.suggestedActionCount} action</span>}
      </span>
    );
  }
  if (status === 'running' || status === 'pending') {
    return <span className="rounded-md bg-indigo-500/10 px-1.5 py-0.5 text-[11px] text-indigo-300 ring-1 ring-inset ring-indigo-500/30">{tr('调查中', 'Investigating')}</span>;
  }
  if (status === 'failed') {
    return <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-[11px] text-red-300 ring-1 ring-inset ring-red-500/30">{tr('失败', 'Failed')}</span>;
  }
  if (status === 'skipped') {
    return <span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">{tr('已跳过', 'Skipped')}</span>;
  }
  return <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-300 ring-1 ring-inset ring-amber-500/30">{tr('未 RCA', 'No RCA')}</span>;
}

function ApprovalBadge({
  pendingCount,
  total,
  latestStatus,
}: {
  pendingCount: number;
  total: number;
  latestStatus?: Approval['status'];
}) {
  const { tr } = useI18n();
  if (pendingCount > 0) {
    return (
    <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-300 ring-1 ring-inset ring-amber-500/30">
      {pendingCount} {tr('待确认', 'pending')}
    </span>
    );
  }
  if (total > 0 && latestStatus) {
    const positive = latestStatus === 'approved' || latestStatus === 'executed';
    return (
      <span className={cn(
        'rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-inset',
        positive
          ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
          : 'bg-red-500/10 text-red-300 ring-red-500/30',
      )}>
        {approvalStatusLabel(latestStatus)}
      </span>
    );
  }
  return (
    <span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-500">{tr('无待确认', 'no pending')}</span>
  );
}

function ReportBadge({ hasReport }: { hasReport: boolean }) {
  const { tr } = useI18n();
  return hasReport ? (
    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
      <FileText size={11} />
      {tr('已报告', 'reported')}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-500">
      <FileText size={11} />
      {tr('未报告', 'no report')}
    </span>
  );
}

function WorkflowBadge({ meta }: { meta?: IncidentOpsMeta }) {
  if (!meta || meta.workflowRunCount === 0) return null;
  const status = meta.latestWorkflowStatus || 'unknown';
  const positive = status === 'succeeded';
  const active = status === 'running' || status === 'pending';
  return (
    <span
      title={meta.latestWorkflowName}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-inset',
        positive
          ? 'bg-indigo-500/10 text-indigo-300 ring-indigo-500/30'
          : active
            ? 'bg-amber-500/10 text-amber-300 ring-amber-500/30'
            : 'bg-red-500/10 text-red-300 ring-red-500/30',
      )}
    >
      <GitBranch size={11} />
      Workflow {workflowStatusLabel(status)}
      {meta.workflowRunCount > 1 && <span className="font-mono">· {meta.workflowRunCount}</span>}
    </span>
  );
}

function workflowStatusLabel(status: string): string {
  switch (status) {
    case 'succeeded':
      return '成功';
    case 'failed':
      return '失败';
    case 'running':
      return '运行中';
    case 'pending':
      return '等待中';
    case 'canceled':
      return '已取消';
    default:
      return status;
  }
}

function EmptyState() {
  const { tr } = useI18n();
  return (
    <div className="flex h-60 flex-col items-center justify-center gap-2 text-zinc-500">
      <CheckCircle2 size={28} className="text-emerald-500/60" />
      <div className="text-sm">{tr('当前没有匹配的事件', 'No matching incidents right now')}</div>
      <div className="text-[11px] text-zinc-600">{tr('调整状态、RCA、待确认或闭环筛选后再看', 'Try changing status, RCA, approval, or closure filters')}</div>
    </div>
  );
}

function localizedOptions<T extends readonly { key: string; zh: string; en: string }[]>(
  options: T,
  tr: (zh: string, en: string) => string,
) {
  return options.map((o) => ({ key: o.key, label: tr(o.zh, o.en) }));
}

function filterIncidentApprovals(items: Approval[], incidentId: number, sessionId?: string): Approval[] {
  const incidentNeedle = `incident_id=${incidentId}`;
  const idNeedle = `incident ${incidentId}`;
  const hashNeedle = `#${incidentId}`;
  return items.filter((a) => {
    if (a.incident_id === incidentId) return true;
    if (sessionId && a.session_id === sessionId) return true;
    const hay = `${a.title}\n${a.summary}\n${a.payload}`.toLowerCase();
    return hay.includes(incidentNeedle.toLowerCase()) || hay.includes(idNeedle.toLowerCase()) || hay.includes(hashNeedle.toLowerCase());
  });
}

function buildIncidentOpsMeta(
  incident: Incident,
  report: InvestigationReport | null,
  approvals: Approval[],
  workflowRuns: Array<{ flow: Flow; run: FlowRun }>,
): IncidentOpsMeta {
  const status = report?.status ?? 'unknown';
  return {
    investigationStatus: status,
    confidence: report?.confidence,
    suggestedActionCount: report?.suggested_actions?.length ?? 0,
    pendingApprovalCount: approvals.filter((a) => a.status === 'pending').length,
    approvalCount: approvals.length,
    latestApprovalStatus: approvals[0]?.status,
    workflowRunCount: workflowRuns.length,
    latestWorkflowStatus: workflowRuns[0]?.run.status,
    latestWorkflowName: workflowRuns[0]?.flow.name,
    hasReport: status === 'ready',
    lastAction: latestActionLabel(incident, report, approvals),
  };
}

async function loadWorkflowRuns(): Promise<Array<{ flow: Flow; run: FlowRun }>> {
  const flows = await listFlows({ limit: 100 });
  const rows = await Promise.all(
    (flows.items ?? []).map(async (flow) => {
      const runs = await listFlowRuns(flow.id, 20).catch(() => ({ items: [] as FlowRun[] }));
      return (runs.items ?? []).map((run) => ({ flow, run }));
    }),
  );
  return rows.flat().sort((a, b) => new Date(b.run.created_at).getTime() - new Date(a.run.created_at).getTime());
}

function triggerIncidentID(trigger: Record<string, unknown> | undefined): number | null {
  if (!trigger) return null;
  const raw = trigger.incident_id ?? trigger.incidentId;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function latestActionLabel(incident: Incident, report: InvestigationReport | null, approvals: Approval[]): string {
  if (incident.status === 'resolved') return 'Resolved';
  if (approvals.some((a) => a.status === 'pending')) return '等待人工确认';
  if (approvals[0]?.status) return approvalStatusLabel(approvals[0].status);
  if (report?.status === 'ready') return 'RCA ready';
  if (report?.status === 'running' || report?.status === 'pending') return '自动调查中';
  if (incident.status === 'acknowledged') return 'Ack';
  if (incident.status === 'silenced') return 'Silenced';
  return 'Open';
}

function approvalStatusLabel(status: Approval['status']): string {
  return ({
    pending: '待确认',
    approved: '人工确认已批准',
    rejected: '人工确认已拒绝',
    executed: '建议动作已执行',
    failed: '建议动作执行失败',
  })[status];
}

function isMissingRca(meta?: IncidentOpsMeta): boolean {
  return !meta || meta.investigationStatus === 'not_started' || meta.investigationStatus === 'unknown' || meta.investigationStatus === 'feature_disabled';
}

function isClosedIncident(incident: Incident, meta?: IncidentOpsMeta): boolean {
  return incident.status === 'resolved' && Boolean(meta?.hasReport) && (meta?.pendingApprovalCount ?? 0) === 0;
}

function matchesOpsFilters(
  incident: Incident,
  meta: IncidentOpsMeta | undefined,
  filters: {
    rcaFilter: OpsFilter;
    confirmFilter: OpsFilter;
    reportFilter: OpsFilter;
    closureFilter: OpsFilter;
  },
): boolean {
  if (filters.rcaFilter === 'rca_ready' && meta?.investigationStatus !== 'ready') return false;
  if (filters.rcaFilter === 'rca_missing' && !isMissingRca(meta)) return false;
  if (filters.rcaFilter === 'rca_running' && meta?.investigationStatus !== 'running' && meta?.investigationStatus !== 'pending') return false;
  if (filters.confirmFilter === 'pending_approval' && (meta?.pendingApprovalCount ?? 0) <= 0) return false;
  if (filters.confirmFilter === 'no_pending_approval' && (meta?.pendingApprovalCount ?? 0) > 0) return false;
  if (filters.reportFilter === 'reported' && !meta?.hasReport) return false;
  if (filters.reportFilter === 'not_reported' && meta?.hasReport) return false;
  if (filters.closureFilter === 'not_closed' && isClosedIncident(incident, meta)) return false;
  if (filters.closureFilter === 'closed' && !isClosedIncident(incident, meta)) return false;
  return true;
}
