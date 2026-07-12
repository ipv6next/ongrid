import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  ClipboardCopy,
  Download,
  FileText,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react';
import { listEdges, type Edge } from '@/api/edges';
import { runSecurityPatrol, type PatrolCheck, type PatrolReport, type PatrolStatus } from '@/api/patrol';
import { archiveReport } from '@/api/reports';
import { Button, EmptyState, PageHeader } from '@/components/ui';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';

const HISTORY_KEY = 'ongrid.securityPatrol.history.v1';

const TEMPLATES = [
  { key: 'ssh_root_login', title: 'SSH 配置', desc: '检查 root 登录策略' },
  { key: 'ssh_password_auth', title: '弱口令风险提示', desc: '检查密码认证是否开启' },
  { key: 'open_ports', title: '开放端口', desc: '采集监听端口清单' },
  { key: 'sudoers', title: 'sudoers', desc: '采集 sudo/wheel 组信息' },
  { key: 'system_accounts', title: '系统账号', desc: '采集系统账号清单' },
  { key: 'login_failed', title: '登录失败', desc: '分析近 24 小时 SSH 失败登录' },
  { key: 'firewall_status', title: '防火墙', desc: '采集 iptables 规则' },
  { key: 'critical_processes', title: '关键服务', desc: '采集关键/高占用进程' },
  { key: 'host_resources', title: '资源使用', desc: '采集主机负载快照' },
  { key: 'recent_changes', title: '最近变更', desc: '检查 /etc 近 7 天变更' },
];

type PatrolHistoryItem = {
  id: string;
  report: PatrolReport;
  checkKeys: string[];
  archivedId?: string;
};

export default function SecurityPatrolPage() {
  const [assets, setAssets] = useState<Edge[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | ''>('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>(TEMPLATES.map((t) => t.key));
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [running, setRunning] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archivedId, setArchivedId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PatrolReport | null>(null);
  const [history, setHistory] = useState<PatrolHistoryItem[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setHistory(readHistory());
  }, []);

  const refreshAssets = useCallback(async () => {
    setLoadingAssets(true);
    try {
      const r = await listEdges();
      const items = (r.items ?? []).filter((x) => x.device_id != null);
      setAssets(items);
      setSelectedDeviceId((cur) => cur || (items[0]?.device_id ?? ''));
      setError(null);
    } catch (e) {
      setError((e as Error).message || '资产加载失败');
    } finally {
      setLoadingAssets(false);
    }
  }, []);

  useEffect(() => {
    void refreshAssets();
  }, [refreshAssets]);

  const selectedAsset = useMemo(
    () => assets.find((a) => a.device_id === selectedDeviceId),
    [assets, selectedDeviceId],
  );

  const run = useCallback(async () => {
    if (!selectedDeviceId || selectedKeys.length === 0) return;
    setRunning(true);
    setError(null);
    setCopied(false);
    setArchivedId('');
    try {
      const r = await runSecurityPatrol(Number(selectedDeviceId), selectedKeys);
      setReport(r);
      const item: PatrolHistoryItem = { id: `${Date.now()}-${r.device_id}`, report: r, checkKeys: selectedKeys };
      const next = [item, ...history].slice(0, 20);
      setHistory(next);
      writeHistory(next);
    } catch (e) {
      setError((e as Error).message || '巡检失败');
    } finally {
      setRunning(false);
    }
  }, [selectedDeviceId, selectedKeys, history]);

  async function copyReport() {
    if (!report?.markdown) return;
    await navigator.clipboard.writeText(report.markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }

  function downloadReport() {
    if (!report?.markdown) return;
    const blob = new Blob([report.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `security-patrol-device-${report.device_id}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function archivePatrolReport(target = report) {
    if (!target?.markdown || archiving) return;
    setArchiving(true);
    try {
      const r = await archiveReport({
        title: `安全巡检报告 - ${target.device_name || target.hostname || `设备 ${target.device_id}`}`,
        kind: 'custom',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        scope_json: JSON.stringify({ template: 'security_patrol', device_id: target.device_id }),
        content_md: target.markdown,
        summary: `共 ${target.summary.total} 项，通过 ${target.summary.pass}，警告 ${target.summary.warn}，失败 ${target.summary.fail}，未知 ${target.summary.unknown}`,
        task_id: `security-patrol:${target.device_id}`,
      });
      if (report?.generated_at === target.generated_at) setArchivedId(r.id);
      const next = history.map((h) => (h.report.generated_at === target.generated_at ? { ...h, archivedId: r.id } : h));
      setHistory(next);
      writeHistory(next);
    } catch (e) {
      setError((e as Error).message || '归档巡检报告失败');
    } finally {
      setArchiving(false);
    }
  }

  const toggleTemplate = (key: string) => {
    setSelectedKeys((cur) => (cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key]));
  };

  return (
    <main className="anim-fade flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ShieldCheck size={15} className="text-emerald-300" />
            安全巡检
          </span>
        }
        subtitle="模板化安全基线巡检：选择检查项，通过 Ongrid Edge 只读隧道执行，并可归档为报告。"
        actions={
          <>
            <Button onClick={refreshAssets} disabled={loadingAssets || running}>
              {loadingAssets ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              刷新资产
            </Button>
            <Button variant="primary" onClick={run} disabled={!selectedDeviceId || running || selectedKeys.length === 0}>
              {running ? <Loader2 size={12} className="animate-spin" /> : <TerminalSquare size={12} />}
              执行巡检
            </Button>
          </>
        }
        extra={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value ? Number(e.target.value) : '')}
              className="h-9 min-w-[260px] rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            >
              {assets.length === 0 && <option value="">暂无可巡检资产</option>}
              {assets.map((a) => (
                <option key={a.id} value={a.device_id ?? ''}>
                  {assetLabel(a)}
                </option>
              ))}
            </select>
            {selectedAsset && (
              <span className="text-xs text-zinc-500">
                {selectedAsset.status === 'online' ? '在线' : '离线'} · device_id={selectedAsset.device_id}
              </span>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">{error}</div>}

        <section className="mb-5 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-100">巡检模板</h2>
            <div className="flex gap-2 text-xs">
              <button className="text-zinc-400 hover:text-zinc-100" onClick={() => setSelectedKeys(TEMPLATES.map((t) => t.key))}>全选</button>
              <button className="text-zinc-400 hover:text-zinc-100" onClick={() => setSelectedKeys([])}>清空</button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
            {TEMPLATES.map((t) => (
              <label key={t.key} className={cn('flex cursor-pointer gap-2 rounded-md border p-3', selectedKeys.includes(t.key) ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700')}>
                <input type="checkbox" checked={selectedKeys.includes(t.key)} onChange={() => toggleTemplate(t.key)} className="mt-0.5" />
                <span>
                  <span className="block text-sm text-zinc-100">{t.title}</span>
                  <span className="block text-xs text-zinc-500">{t.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        {!report ? (
          <EmptyState title="选择资产和模板开始巡检" hint="每次巡检会写入审计日志，结果可复制、下载或归档到报告中心。" />
        ) : (
          <div className="space-y-5">
            <ReportSummary
              report={report}
              copied={copied}
              archivedId={archivedId}
              archiving={archiving}
              onCopy={copyReport}
              onDownload={downloadReport}
              onArchive={() => void archivePatrolReport(report)}
            />
            <ChecksTable checks={report.checks} />
          </div>
        )}

        <section className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/40">
          <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
            <History size={15} className="text-zinc-400" />
            <h2 className="text-sm font-semibold text-zinc-100">巡检历史</h2>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">{history.length}</span>
          </header>
          {history.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-500">暂无巡检历史</div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {history.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => {
                    setReport(h.report);
                    setArchivedId(h.archivedId ?? '');
                  }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-zinc-800/40"
                >
                  <div>
                    <div className="text-sm text-zinc-100">{h.report.device_name || h.report.hostname || `设备 ${h.report.device_id}`}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {new Date(h.report.generated_at).toLocaleString()} · 模板 {h.checkKeys.length} 项 · 失败 {h.report.summary.fail} · 警告 {h.report.summary.warn}
                    </div>
                  </div>
                  {h.archivedId ? (
                    <Link to={`/reports/${h.archivedId}`} onClick={(e) => e.stopPropagation()} className="text-xs text-indigo-300 hover:underline">查看报告</Link>
                  ) : (
                    <span className="text-xs text-zinc-500">未归档</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ReportSummary({
  report,
  copied,
  archivedId,
  archiving,
  onCopy,
  onDownload,
  onArchive,
}: {
  report: PatrolReport;
  copied: boolean;
  archivedId: string;
  archiving: boolean;
  onCopy(): void;
  onDownload(): void;
  onArchive(): void;
}) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">{report.device_name || report.hostname || `设备 ${report.device_id}`}</h2>
          <div className="mt-1 text-xs text-zinc-500">生成于 {relativeTime(report.generated_at)} · 共 {report.summary.total} 项</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SummaryChip label="通过" value={report.summary.pass} className="bg-emerald-500/15 text-emerald-200" />
          <SummaryChip label="警告" value={report.summary.warn} className="bg-amber-500/15 text-amber-200" />
          <SummaryChip label="失败" value={report.summary.fail} className="bg-red-500/15 text-red-200" />
          <SummaryChip label="未知" value={report.summary.unknown} className="bg-zinc-700/60 text-zinc-300" />
          <Button onClick={onCopy}>{copied ? <CheckCircle2 size={12} /> : <ClipboardCopy size={12} />}{copied ? '已复制' : '复制报告'}</Button>
          <Button onClick={onDownload}><Download size={12} />导出 Markdown</Button>
          {archivedId ? (
            <Link to={`/reports/${archivedId}`} className="inline-flex items-center gap-1.5 rounded-md border border-indigo-700 bg-indigo-950/30 px-2.5 py-1.5 text-xs text-indigo-200 hover:bg-indigo-900/40">
              <FileText size={12} />查看归档
            </Link>
          ) : (
            <Button onClick={onArchive} disabled={archiving}>{archiving ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}归档报告</Button>
          )}
        </div>
      </div>
    </section>
  );
}

function ChecksTable({ checks }: { checks: PatrolCheck[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/30">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="border-b border-zinc-800 bg-zinc-900/70 text-xs text-zinc-500">
          <tr>
            <th className="w-32 px-4 py-3">状态</th>
            <th className="w-44 px-4 py-3">检查项</th>
            <th className="px-4 py-3">结论与证据</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/70">
          {checks.map((c) => <CheckRow key={c.key} check={c} />)}
        </tbody>
      </table>
    </section>
  );
}

function CheckRow({ check }: { check: PatrolCheck }) {
  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <span className={cn('inline-flex rounded-md px-2 py-1 text-xs font-medium', statusClass(check.status))}>{statusLabel(check.status)}</span>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium text-zinc-100">{check.title}</div>
        <div className="mt-1 text-xs text-zinc-500">{check.severity}</div>
      </td>
      <td className="px-4 py-3">
        <div className="text-zinc-200">{check.conclusion}</div>
        {check.error && <div className="mt-1 text-xs text-red-300">{check.error}</div>}
        {check.command && <code className="mt-2 inline-block max-w-full truncate rounded bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-400">{check.command}</code>}
        {check.evidence && <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs leading-relaxed text-zinc-300">{check.evidence}</pre>}
      </td>
    </tr>
  );
}

function SummaryChip({ label, value, className }: { label: string; value: number; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs', className)}>{label}<span className="font-mono">{value}</span></span>;
}

function statusLabel(status: PatrolStatus) {
  switch (status) {
    case 'pass': return '通过';
    case 'warn': return '警告';
    case 'fail': return '失败';
    default: return '未知';
  }
}

function statusClass(status: PatrolStatus) {
  switch (status) {
    case 'pass': return 'bg-emerald-500/15 text-emerald-200';
    case 'warn': return 'bg-amber-500/15 text-amber-200';
    case 'fail': return 'bg-red-500/15 text-red-200';
    default: return 'bg-zinc-700/60 text-zinc-300';
  }
}

function assetLabel(a: Edge) {
  const hostInfo = typeof a.host_info === 'object' && a.host_info ? a.host_info : {};
  const hostname = typeof hostInfo.hostname === 'string' ? hostInfo.hostname : '';
  const ipAddress = typeof hostInfo.ip_address === 'string' ? hostInfo.ip_address : '';
  const host = hostname || a.name || `Edge ${a.id}`;
  const ip = ipAddress ? ` · ${ipAddress}` : '';
  return `${host}${ip}`;
}

function readHistory(): PatrolHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(items: PatrolHistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {
    // best effort only
  }
}
