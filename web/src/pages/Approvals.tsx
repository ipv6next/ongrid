import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { approveApproval, listApprovals, rejectApproval, type Approval } from '@/api/approvals';
import { ApiError } from '@/api/client';
import { PageHeader } from '@/components/ui';
import { cn } from '@/lib/cn';

const tabs = [
  ['', '全部'], ['pending', '待确认'], ['approved', '已批准'],
  ['executed', '已执行'], ['rejected', '已拒绝'], ['failed', '执行失败'],
] as const;

export default function ApprovalsPage() {
  const [items, setItems] = useState<Approval[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listApprovals(status || undefined);
      setItems(res.items ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);
  const groups = useMemo(() => groupBySource(items), [items]);

  const approve = async (item: Approval) => {
    if (!window.confirm(`确认批准：${item.title}？\n批准后，明确绑定的 Skill 或 Workflow 将立即执行。`)) return;
    setBusy(item.id);
    try { await approveApproval(item.id); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const reject = async (item: Approval) => {
    const reason = window.prompt('请输入拒绝原因（将写入事件时间线和审计）');
    if (reason === null) return;
    setBusy(item.id);
    try { await rejectApproval(item.id, reason); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };

  return (
    <main className="anim-fade flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="人工确认"
        subtitle="高风险建议动作必须由人员确认；只有绑定明确目标和参数的 Skill / Workflow 才会在批准后执行。"
        actions={<button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"><RefreshCw size={13} />刷新</button>}
        extra={<div className="flex flex-wrap gap-1">{tabs.map(([key, label]) => <button key={key} type="button" onClick={() => setStatus(key)} className={cn('rounded-md px-2.5 py-1 text-xs', status === key ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-200')}>{label}</button>)}</div>}
      />
      <div className="flex-1 overflow-auto px-6 py-4">
        {error && <div className="mb-3 rounded-md border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">{error}</div>}
        {loading ? <div className="py-16 text-center text-sm text-zinc-500">正在加载...</div> :
          groups.length === 0 ? <div className="py-16 text-center text-sm text-zinc-500">当前筛选下没有确认项</div> :
          <div className="space-y-4">{groups.map(([source, rows]) => (
            <section key={source} className="rounded-lg border border-zinc-800 bg-zinc-950/40">
              <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-100"><ShieldCheck size={15} className="text-indigo-300" />{sourceLabel(source)}<span className="rounded bg-zinc-800 px-1.5 font-mono text-[10px] text-zinc-400">{rows.length}</span></header>
              <div className="divide-y divide-zinc-800/70">{rows.map((a) => {
                const expanded = Boolean(open[a.id]);
                return <article key={a.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <button type="button" title="展开详情" onClick={() => setOpen((v) => ({ ...v, [a.id]: !expanded }))} className="mt-0.5 text-zinc-500">{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-zinc-100">{a.title}</strong><Chip text={statusLabel(a.status)} tone={statusTone(a.status)} /><Chip text={riskLabel(a.risk_level)} tone={a.risk_level === 'high' ? 'red' : 'amber'} /><Chip text={actionLabel(a.action_type)} tone="gray" /></div>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">{a.recommendation || a.summary || '暂无推荐理由'}</p>
                      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-zinc-600">{a.incident_id ? <span>事件 #{a.incident_id}</span> : null}<span>来源：{a.source_type || a.source}</span><span>{new Date(a.created_at).toLocaleString()}</span></div>
                      {expanded && <div className="mt-3 grid gap-3 lg:grid-cols-2"><Block title="执行 payload" value={pretty(a.payload)} /><Block title="执行前置条件" value={pretty(a.prerequisites || '[]')} /><Block title="执行结果" value={a.result ? pretty(a.result) : '尚未执行'} />{a.reason && <Block title="处理意见" value={a.reason} />}</div>}
                    </div>
                    {a.status === 'pending' && <div className="flex shrink-0 gap-2"><button disabled={busy === a.id} onClick={() => void approve(a)} className="inline-flex items-center gap-1 rounded-md border border-emerald-700 px-2 py-1 text-xs text-emerald-300 disabled:opacity-40"><Check size={13} />批准</button><button disabled={busy === a.id} onClick={() => void reject(a)} className="inline-flex items-center gap-1 rounded-md border border-red-900 px-2 py-1 text-xs text-red-300 disabled:opacity-40"><X size={13} />拒绝</button></div>}
                  </div>
                </article>;
              })}</div>
            </section>
          ))}</div>}
      </div>
    </main>
  );
}

function groupBySource(items: Approval[]): Array<[string, Approval[]]> {
  const map = new Map<string, Approval[]>();
  for (const item of items) {
    const key = item.source_type || item.source || 'other';
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return [...map.entries()];
}
function sourceLabel(v: string) { return ({ incident: '事件建议', rca: 'RCA 建议', workflow: 'Workflow 建议', flow: 'Workflow 建议', skill: 'Skill 动作', agent: 'Agent 会话' } as Record<string, string>)[v] || '其他来源'; }
function statusLabel(v: string) { return ({ pending: '待确认', approved: '已批准', rejected: '已拒绝', executed: '已执行', failed: '执行失败' } as Record<string, string>)[v] || v; }
function actionLabel(v?: string) { return ({ skill: '执行 Skill', workflow: '运行 Workflow', manual: '人工实施' } as Record<string, string>)[v || 'manual'] || v || '人工实施'; }
function riskLabel(v?: string) { return ({ high: '高风险', medium: '中风险', low: '低风险', none: '无风险' } as Record<string, string>)[v || 'medium'] || v || '中风险'; }
function statusTone(v: string): Tone { return v === 'pending' ? 'amber' : v === 'executed' || v === 'approved' ? 'green' : v === 'failed' ? 'red' : 'gray'; }
type Tone = 'gray' | 'amber' | 'green' | 'red';
function Chip({ text, tone }: { text: string; tone: Tone }) { const colors = { gray: 'bg-zinc-800 text-zinc-300', amber: 'bg-amber-500/15 text-amber-300', green: 'bg-emerald-500/15 text-emerald-300', red: 'bg-red-500/15 text-red-300' }; return <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', colors[tone])}>{text}</span>; }
function Block({ title, value }: { title: string; value: string }) { return <div><div className="mb-1 text-[11px] text-zinc-500">{title}</div><pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 text-[10px] text-zinc-400">{value}</pre></div>; }
function pretty(v: string) { try { return JSON.stringify(JSON.parse(v), null, 2); } catch { return v || '-'; } }
