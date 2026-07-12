import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  RotateCcw,
  Settings,
  Shield,
  Terminal,
  X,
} from 'lucide-react';
import { ApiError } from '@/api/client';
import { listAuditLogs, type AuditLog, type AuditListFilters, type AuditStatus } from '@/api/audit';
import { listShellSessions, type ShellSession } from '@/api/webshell';
import { Button, Card, Chip, EmptyState, PageHeader } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useMe } from '@/store/me';

type AuditCategory = '' | 'webshell' | 'ai_tool' | 'rca' | 'config' | 'closure' | 'report';
type FilterState = AuditListFilters & { category?: AuditCategory };

const CATEGORY_OPTIONS: Array<{ value: AuditCategory; label: string; icon: typeof Shield; hint: string }> = [
  { value: '', label: '全部审计', icon: Shield, hint: '所有可见操作' },
  { value: 'webshell', label: 'WebShell', icon: Terminal, hint: '浏览器命令与会话' },
  { value: 'ai_tool', label: 'AI tool', icon: Bot, hint: '技能和工具调用' },
  { value: 'rca', label: 'RCA', icon: ClipboardCheck, hint: '调查和根因链路' },
  { value: 'config', label: '配置变更', icon: Settings, hint: '规则、设置、通道' },
  { value: 'closure', label: '处置闭环', icon: CheckCircle2, hint: 'Ack / Resolve / 人工确认' },
  { value: 'report', label: '报告导出', icon: FileText, hint: '归档和分享' },
];

const ACTION_OPTIONS = [
  '',
  'auth_login_failed',
  'incident_ack',
  'incident_resolve',
  'incident_silence',
  'approval_approve',
  'approval_reject',
  'skill_execute',
  'report_archive',
  'report_export',
  'rule_create',
  'rule_update',
  'rule_delete',
  'setting_update',
  'setting_delete',
  'channel_create',
  'channel_update',
  'channel_delete',
  'device_update',
  'device_delete',
  'user_create',
  'user_update',
  'user_delete',
  'repo_create',
  'repo_sync',
  'repo_delete',
];

const RESOURCE_OPTIONS = ['', 'incident', 'approval', 'skill', 'report', 'rule', 'setting', 'channel', 'device', 'user', 'repo', 'auth'];

export default function SettingsAuditLog() {
  const { me, loading: meLoading } = useMe();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = me?.role === 'admin';

  const urlFilter = useMemo(() => filterFromSearch(searchParams), [searchParams]);
  const [filter, setFilter] = useState<FilterState>(urlFilter);
  const [items, setItems] = useState<AuditLog[]>([]);
  const [shellSessions, setShellSessions] = useState<ShellSession[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<AuditLog | null>(null);

  useEffect(() => {
    setFilter(urlFilter);
  }, [urlFilter]);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setErr('');
    try {
      const serverFilter = toServerFilter(filter);
      const [r, shell] = await Promise.all([
        listAuditLogs(serverFilter),
        (filter.category === 'webshell' ? listShellSessions() : Promise.resolve({ items: [], total: 0 })),
      ]);
      setItems(r.items ?? []);
      setTotal(r.total ?? 0);
      setShellSessions(shell.items ?? []);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filter, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayed = useMemo(() => {
    const rows = items.filter((row) => matchesCategory(row, filter.category ?? ''));
    return rows;
  }, [items, filter.category]);

  const applyFilter = useCallback(
    (patch: Partial<FilterState>) => {
      const next = { ...filter, ...patch, limit: patch.limit ?? filter.limit ?? 200 };
      setFilter(next);
      setSearchParams(searchFromFilter(next), { replace: true });
    },
    [filter, setSearchParams],
  );

  const clearFilter = useCallback(() => {
    const next: FilterState = { limit: 200 };
    setFilter(next);
    setSearchParams(searchFromFilter(next), { replace: true });
  }, [setSearchParams]);

  if (meLoading) {
    return (
      <main className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-500">
        <Loader2 size={16} className="mr-2 animate-spin" /> 正在加载审计日志
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="anim-fade flex flex-1 flex-col overflow-hidden p-6">
        <Card className="p-6">
          <EmptyState icon={Shield} title="需要管理员权限" hint="只有管理员可以查看审计日志。" />
        </Card>
      </main>
    );
  }

  return (
    <main className="anim-fade flex flex-1 flex-col overflow-hidden p-6">
      <PageHeader
        title="审计日志"
        subtitle={`共 ${total} 条记录，当前显示 ${displayed.length} 条；保留 180 天`}
        actions={
          <Button onClick={load} variant="ghost">
            <RefreshCw size={14} className={cn('mr-1', loading && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      <Card className="mt-4 p-3">
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            {CATEGORY_OPTIONS.map((cat) => {
              const Icon = cat.icon;
              const active = (filter.category ?? '') === cat.value;
              return (
                <button
                  key={cat.value || 'all'}
                  type="button"
                  onClick={() => applyFilter(categoryPatch(cat.value))}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition',
                    active
                      ? 'border-violet-400 bg-violet-500/15 text-violet-200'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700',
                  )}
                  title={cat.hint}
                >
                  <Icon size={14} />
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Filter size={14} className="shrink-0 text-zinc-500" />
            <input
              type="text"
              value={filter.user_email ?? ''}
              onChange={(e) => applyFilter({ user_email: e.target.value || undefined })}
              placeholder="用户邮箱"
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-600"
            />
            <select
              value={filter.action ?? ''}
              onChange={(e) => applyFilter({ action: e.target.value || undefined })}
              className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-600"
            >
              {ACTION_OPTIONS.map((a) => (
                <option key={a || 'all'} value={a}>
                  {a ? actionLabel(a) : '全部 action'}
                </option>
              ))}
            </select>
            <select
              value={filter.resource_type ?? ''}
              onChange={(e) => applyFilter({ resource_type: e.target.value || undefined })}
              className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-600"
            >
              {RESOURCE_OPTIONS.map((r) => (
                <option key={r || 'all'} value={r}>
                  {r ? resourceLabel(r) : '全部资源'}
                </option>
              ))}
            </select>
            <select
              value={filter.status ?? ''}
              onChange={(e) => applyFilter({ status: (e.target.value as AuditStatus) || undefined })}
              className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-600"
            >
              <option value="">全部结果</option>
              <option value="success">成功</option>
              <option value="failure">失败</option>
              <option value="denied">拒绝</option>
            </select>
            <select
              value={filter.limit ?? 200}
              onChange={(e) => applyFilter({ limit: Number(e.target.value) })}
              className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-600"
            >
              <option value={50}>最近 50 条</option>
              <option value={100}>最近 100 条</option>
              <option value={200}>最近 200 条</option>
              <option value={500}>最近 500 条</option>
            </select>
            {hasActiveFilter(filter) && (
              <Button variant="ghost" onClick={clearFilter}>
                <X size={14} className="mr-1" />
                清空筛选
              </Button>
            )}
          </div>
        </div>
      </Card>

      {err && <Card className="mt-3 border-red-700/40 bg-red-900/20 p-3 text-sm text-red-300">{err}</Card>}

      {filter.category === 'webshell' && (
        <WebShellAuditCard items={shellSessions} loading={loading} />
      )}

      <Card className="mt-3 flex-1 overflow-auto">
        <table className="min-w-full text-left text-[13px]">
          <thead className="sticky top-0 z-10 bg-zinc-900 text-zinc-400">
            <tr>
              <th className="px-3 py-2">时间</th>
              <th className="px-3 py-2">用户</th>
              <th className="px-3 py-2">动作</th>
              <th className="px-3 py-2">资源</th>
              <th className="px-3 py-2">结果</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {displayed.map((row) => (
              <tr key={row.id} className="border-t border-zinc-800 hover:bg-zinc-900/40">
                <td className="px-3 py-2">
                  <div className="font-mono text-xs text-zinc-300">{fmtTime(row.occurred_at)}</div>
                  <div className="text-[11px] text-zinc-500">{relativeTimeClean(row.occurred_at)}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="text-zinc-200">{row.user_email || '-'}</div>
                  {row.role && <div className="text-[11px] text-zinc-500">{row.role}</div>}
                </td>
                <td className="px-3 py-2">
                  <div className="text-zinc-200">{actionLabel(row.action)}</div>
                  <div className="font-mono text-[11px] text-zinc-500">{row.action}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="text-zinc-300">{resourceLabel(row.resource_type)}</div>
                  <div className="max-w-[280px] truncate text-[11px] text-zinc-500">
                    {row.resource_name || row.resource_id || '-'}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <StatusChip status={row.status} />
                </td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-400">{row.ip || '-'}</td>
                <td className="px-3 py-2 text-right">
                  <Button variant="ghost" onClick={() => setSelected(row)}>
                    详情
                  </Button>
                </td>
              </tr>
            ))}
            {!loading && displayed.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-zinc-500">
                  没有匹配的审计记录
                </td>
              </tr>
            )}
            {loading && displayed.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-zinc-500">
                  <Loader2 size={14} className="mr-2 inline animate-spin" />
                  正在加载
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {selected && <DetailDrawer row={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}

function WebShellAuditCard({ items, loading }: { items: ShellSession[]; loading: boolean }) {
  return (
    <Card className="mt-3 overflow-auto">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-100">WebShell 会话审计</h2>
          <p className="mt-0.5 text-xs text-zinc-500">来自 Ongrid WebShell 原生会话审计，记录会话、设备、字节数和终止原因。</p>
        </div>
        <Chip className="bg-zinc-800 text-zinc-300">{items.length} 条</Chip>
      </div>
      <table className="min-w-full text-left text-[13px]">
        <thead className="text-zinc-400">
          <tr>
            <th className="px-3 py-2">开始时间</th>
            <th className="px-3 py-2">SSH 用户</th>
            <th className="px-3 py-2">设备</th>
            <th className="px-3 py-2">状态</th>
            <th className="px-3 py-2">输入/输出</th>
            <th className="px-3 py-2">结束原因</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id} className="border-t border-zinc-800">
              <td className="px-3 py-2">
                <div className="font-mono text-xs text-zinc-300">{fmtTime(s.started_at)}</div>
                <div className="text-[11px] text-zinc-500">{relativeTimeClean(s.started_at)}</div>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-zinc-200">{s.ssh_user || '-'}</td>
              <td className="px-3 py-2 text-zinc-300">
                device #{s.device_id}
                <div className="text-[11px] text-zinc-500">edge #{s.edge_id}</div>
              </td>
              <td className="px-3 py-2">
                <Chip className={s.is_active ? 'bg-green-900/30 text-green-300' : 'bg-zinc-800 text-zinc-300'}>
                  {s.is_active ? '会话中' : '已结束'}
                </Chip>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-zinc-400">
                {formatBytesSmall(s.bytes_stdin)} / {formatBytesSmall(s.bytes_stdout)}
              </td>
              <td className="px-3 py-2 text-zinc-400">{shellEndReason(s.terminated_by, s.exit_code)}</td>
            </tr>
          ))}
          {!loading && items.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">没有 WebShell 会话记录</td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function filterFromSearch(params: URLSearchParams): FilterState {
  return {
    user_email: params.get('user_email') || undefined,
    action: params.get('action') || undefined,
    resource_type: params.get('resource_type') || undefined,
    status: (params.get('status') as AuditStatus) || undefined,
    from: params.get('from') || undefined,
    to: params.get('to') || undefined,
    limit: Number(params.get('limit') || 200),
    category: (params.get('category') as AuditCategory) || '',
  };
}

function searchFromFilter(filter: FilterState): URLSearchParams {
  const qs = new URLSearchParams();
  if (filter.user_email) qs.set('user_email', filter.user_email);
  if (filter.action) qs.set('action', filter.action);
  if (filter.resource_type) qs.set('resource_type', filter.resource_type);
  if (filter.status) qs.set('status', filter.status);
  if (filter.from) qs.set('from', filter.from);
  if (filter.to) qs.set('to', filter.to);
  if (filter.category) qs.set('category', filter.category);
  if (filter.limit && filter.limit !== 200) qs.set('limit', String(filter.limit));
  return qs;
}

function toServerFilter(filter: FilterState): AuditListFilters {
  const next: AuditListFilters = {
    user_email: filter.user_email,
    action: filter.action,
    resource_type: filter.resource_type,
    status: filter.status,
    from: filter.from,
    to: filter.to,
    limit: filter.limit ?? 200,
  };
  return next;
}

function categoryPatch(category: AuditCategory): Partial<FilterState> {
  switch (category) {
    case 'ai_tool':
      return { category, action: 'skill_execute', resource_type: 'skill' };
    case 'config':
      return { category, action: undefined, resource_type: undefined };
    case 'closure':
      return { category, action: undefined, resource_type: undefined };
    case 'report':
      return { category, action: undefined, resource_type: 'report' };
    case 'rca':
      return { category, action: undefined, resource_type: undefined };
    case 'webshell':
      return { category, action: undefined, resource_type: undefined };
    default:
      return { category: '', action: undefined, resource_type: undefined, status: undefined };
  }
}

function hasActiveFilter(filter: FilterState): boolean {
  return Boolean(filter.user_email || filter.action || filter.resource_type || filter.status || filter.category || filter.from || filter.to);
}

function matchesCategory(row: AuditLog, category: AuditCategory): boolean {
  if (!category) return true;
  const haystack = `${row.action} ${row.resource_type} ${row.resource_id} ${row.resource_name} ${row.payload_json ?? ''}`.toLowerCase();
  switch (category) {
    case 'webshell':
      return haystack.includes('webshell') || haystack.includes('shell') || haystack.includes('terminal');
    case 'ai_tool':
      return row.action === 'skill_execute' || row.resource_type === 'skill' || haystack.includes('tool_call');
    case 'rca':
      return haystack.includes('rca') || haystack.includes('investigation') || haystack.includes('root_cause');
    case 'config':
      return ['rule', 'setting', 'channel'].includes(row.resource_type) || row.action.includes('rule_') || row.action.includes('setting_') || row.action.includes('channel_');
    case 'closure':
      return row.action.startsWith('incident_') || row.action.startsWith('approval_');
    case 'report':
      return row.resource_type === 'report' || row.action.startsWith('report_');
    default:
      return true;
  }
}

function StatusChip({ status }: { status: AuditLog['status'] }) {
  const cls =
    status === 'success'
      ? 'bg-green-900/30 text-green-300'
      : status === 'denied'
        ? 'bg-yellow-900/30 text-yellow-300'
        : 'bg-red-900/30 text-red-300';
  const label = status === 'success' ? '成功' : status === 'denied' ? '拒绝' : '失败';
  return <Chip className={cls}>{label}</Chip>;
}

function DetailDrawer({ row, onClose }: { row: AuditLog; onClose: () => void }) {
  const payload = parsePayload(row.payload_json);
  const links = contextLinks(row, payload.value);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-y-auto bg-zinc-950 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">审计详情</h2>
            <p className="mt-1 text-xs text-zinc-500">{actionLabel(row.action)} · {resourceLabel(row.resource_type)}</p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>

        <dl className="space-y-2 text-sm">
          <Row label="时间" value={fmtTime(row.occurred_at)} />
          <Row label="动作" value={`${actionLabel(row.action)} (${row.action})`} />
          <Row label="资源" value={`${resourceLabel(row.resource_type)} / ${row.resource_name || row.resource_id || '-'}`} />
          <Row label="用户" value={`${row.user_email || '-'} (${row.role || 'n/a'})`} />
          <Row label="结果" value={row.status} />
          <Row label="IP" value={row.ip || '-'} mono />
          <Row label="User-Agent" value={row.user_agent || '-'} mono />
          {row.error_message && <Row label="错误" value={row.error_message} mono />}
          {row.request_id && <Row label="request_id" value={row.request_id} mono />}
        </dl>

        <section className="mt-5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">上下文回跳</div>
          {links.length === 0 ? (
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-500">
              这条记录没有可识别的业务对象。
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {links.map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 hover:border-violet-500 hover:text-violet-200"
                >
                  <RotateCcw size={12} />
                  {link.label}
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="mt-5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">payload 摘要</div>
          <PayloadSummary value={payload.value} raw={row.payload_json} />
        </section>

        {payload.text && (
          <section className="mt-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">原始 payload</div>
            <pre className="max-h-[360px] overflow-auto rounded-md border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-200">
              {payload.text}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={cn('break-words text-zinc-200', mono && 'break-all font-mono text-xs')}>{value}</dd>
    </div>
  );
}

function PayloadSummary({ value, raw }: { value: unknown; raw?: string }) {
  const entries = payloadEntries(value, raw);
  if (entries.length === 0) {
    return <div className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-500">没有 payload。</div>;
  }
  return (
    <div className="overflow-hidden rounded-md border border-zinc-800">
      <table className="min-w-full text-left text-xs">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="border-t border-zinc-800 first:border-t-0">
              <th className="w-36 bg-zinc-900/70 px-3 py-2 font-medium text-zinc-400">{k}</th>
              <td className="px-3 py-2 font-mono text-zinc-200">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parsePayload(raw?: string): { value: unknown; text: string } {
  if (!raw) return { value: null, text: '' };
  try {
    const value = JSON.parse(raw);
    return { value, text: JSON.stringify(value, null, 2) };
  } catch {
    return { value: raw, text: raw };
  }
}

function payloadEntries(value: unknown, raw?: string): Array<[string, string]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return raw ? [['raw', String(raw).slice(0, 500)]] : [];
  }
  return Object.entries(value as Record<string, unknown>)
    .slice(0, 8)
    .map(([k, v]) => [k, compactValue(v)]);
}

function compactValue(v: unknown): string {
  if (v == null) return '-';
  if (typeof v === 'string') return v.length > 240 ? `${v.slice(0, 240)}...` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const text = JSON.stringify(v);
  return text.length > 240 ? `${text.slice(0, 240)}...` : text;
}

function contextLinks(row: AuditLog, payload: unknown): Array<{ label: string; href: string }> {
  const links: Array<{ label: string; href: string }> = [];
  const obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const incidentId = firstString(row.resource_type === 'incident' ? row.resource_id : undefined, obj.incident_id, obj.incidentId);
  const reportId = firstString(row.resource_type === 'report' ? row.resource_id : undefined, obj.report_id, obj.reportId);
  const deviceId = firstString(row.resource_type === 'device' ? row.resource_id : undefined, obj.device_id, obj.deviceId);
  const sessionId = firstString(obj.session_id, obj.sessionId, obj.audit_session_id, obj.auditSessionId);

  if (incidentId) links.push({ label: `事件 #${incidentId}`, href: `/alerts/incidents/${encodeURIComponent(incidentId)}` });
  if (reportId) links.push({ label: '报告详情', href: `/reports/${encodeURIComponent(reportId)}` });
  if (deviceId) links.push({ label: `资产 #${deviceId}`, href: `/devices/${encodeURIComponent(deviceId)}` });
  if (sessionId) links.push({ label: '会话上下文', href: `/chat/${encodeURIComponent(sessionId)}` });
  return links;
}

function firstString(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

function fmtTime(s: string): string {
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function relativeTimeClean(input: string): string {
  const t = new Date(input).getTime();
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

function formatBytesSmall(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = value;
  let idx = 0;
  while (n >= 1024 && idx < units.length - 1) {
    n /= 1024;
    idx += 1;
  }
  return `${n.toFixed(n < 10 && idx > 0 ? 1 : 0)} ${units[idx]}`;
}

function shellEndReason(reason?: string, exitCode?: number): string {
  if (!reason) return '-';
  const labels: Record<string, string> = {
    user: '用户关闭',
    idle: '空闲超时',
    disconnect: '连接断开',
    admin_kill: '管理员终止',
    ssh_auth_fail: 'SSH 认证失败',
    ssh_exit: `SSH 退出${exitCode ? ` (${exitCode})` : ''}`,
    device_offline: '设备离线',
  };
  return labels[reason] ?? reason;
}

const ACTION_LABELS: Record<string, string> = {
  auth_login_failed: '登录失败',
  user_create: '新建用户',
  user_update: '修改用户',
  user_delete: '删除用户',
  user_export: '导出用户',
  device_update: '修改资产',
  device_delete: '删除资产',
  rule_create: '新建告警规则',
  rule_update: '修改告警规则',
  rule_delete: '删除告警规则',
  incident_ack: 'Ack 事件',
  incident_resolve: 'Resolve 事件',
  incident_silence: 'Silence 事件',
  approval_approve: '批准人工确认',
  approval_reject: '拒绝人工确认',
  report_archive: '归档报告',
  report_export: '导出/分享报告',
  setting_update: '修改设置',
  setting_delete: '删除设置',
  channel_create: '新建通道',
  channel_update: '修改通道',
  channel_delete: '删除通道',
  repo_create: '新建代码仓库',
  repo_delete: '删除代码仓库',
  repo_sync: '同步代码仓库',
  skill_install: '安装技能',
  skill_uninstall: '卸载技能',
  skill_execute: '执行技能/工具',
};

const RESOURCE_LABELS: Record<string, string> = {
  user: '用户',
  device: '资产',
  incident: '事件',
  approval: '人工确认',
  report: '报告',
  setting: '设置',
  rule: '告警规则',
  channel: '通知通道',
  repo: '代码仓库',
  skill: '技能',
  llm: 'LLM',
  git_ssh_key: 'Git SSH 密钥',
  grafana: 'Grafana',
  rag: '知识库',
  audit: '审计',
  auth: '认证',
};

export function formatAuditAction(action: string): string {
  return actionLabel(action);
}

export function formatAuditResource(resource: string): string {
  return resourceLabel(resource);
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function resourceLabel(resource: string): string {
  return RESOURCE_LABELS[resource] ?? resource;
}
