import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, ChevronLeft, ChevronRight, FileBarChart, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { usePoll } from '@/lib/usePoll';
import { listReports, listSchedules, type ReportListItem, type ReportStatus } from '@/api/reports';

const POLL_MS = 20_000;
const PAGE_SIZE = 20;

export const STATUS_STYLE: Record<ReportStatus, string> = {
  ready: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  generating: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  pending: 'bg-zinc-700/40 text-zinc-300 border-zinc-600/40',
  failed: 'bg-red-500/15 text-red-300 border-red-500/30',
};

const STATUS_FILTERS = [
  { key: '', label: '全部' },
  { key: 'ready', label: '已就绪' },
  { key: 'generating', label: '生成中' },
  { key: 'pending', label: '待生成' },
  { key: 'failed', label: '失败' },
];

const KIND_FILTERS = [
  { key: '', label: '全部' },
  { key: 'daily', label: '日报' },
  { key: 'weekly', label: '周报' },
  { key: 'monthly', label: '月报' },
  { key: 'custom', label: '归档报告' },
];

export const KIND_ZH: Record<string, string> = { daily: '日报', weekly: '周报', monthly: '月报', custom: '归档报告' };
export const KIND_EN: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', custom: 'Custom' };
const STATUS_ZH: Record<ReportStatus, string> = { ready: '已就绪', generating: '生成中', pending: '待生成', failed: '失败' };

export function periodLabel(title: string): string {
  const i = title.indexOf(' · ');
  if (i >= 0) return title.slice(i + 3);
  const legacy = title.indexOf(' 路 ');
  return legacy >= 0 ? title.slice(legacy + 3) : title;
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
    <div className="flex items-center gap-1.5">
      <span className="text-zinc-500">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={cn(
              'rounded px-2 py-0.5 text-[11px]',
              value === o.key ? 'bg-indigo-500/15 text-indigo-200' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReportCards({
  taskRef,
  showFilters = true,
  emptyHint,
}: {
  taskRef?: string;
  showFilters?: boolean;
  emptyHint?: string;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<ReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [page, setPage] = useState(0);
  const [taskNames, setTaskNames] = useState<Record<number, string>>({});

  useEffect(() => {
    if (taskRef != null) return;
    let alive = true;
    listSchedules()
      .then((r) => {
        if (!alive) return;
        const m: Record<number, string> = {};
        for (const s of r.schedules ?? []) m[s.id] = s.name;
        setTaskNames(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [taskRef]);

  const load = useCallback(async () => {
    try {
      const res = await listReports({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        status: statusFilter || undefined,
        kind: kindFilter || undefined,
        task_id: taskRef,
      });
      setItems(res.reports ?? []);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, kindFilter, page, taskRef]);

  useEffect(() => {
    setPage(0);
  }, [statusFilter, kindFilter, taskRef]);

  useEffect(() => {
    void load();
  }, [load]);
  usePoll(load, POLL_MS);

  return (
    <div className="flex flex-1 flex-col">
      {showFilters && (
        <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-zinc-400">
          <FilterGroup label="状态" options={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />
          {taskRef == null && <FilterGroup label="类型" options={KIND_FILTERS} value={kindFilter} onChange={setKindFilter} />}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-500">
          <Loader2 size={16} className="mx-auto mb-2 animate-spin" />
          加载中...
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center text-sm text-zinc-500">
          {page > 0 ? '这一页没有报告' : emptyHint ?? '暂无报告。'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((r) => (
            <article
              key={r.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/reports/${r.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/reports/${r.id}`);
                }
              }}
              className="group flex min-h-[190px] cursor-pointer flex-col overflow-hidden rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-900/70"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-indigo-200">
                  {r.status === 'failed' ? <XCircle size={18} className="text-red-300" /> : <FileBarChart size={18} />}
                </span>
                <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium', STATUS_STYLE[r.status])}>
                  {STATUS_ZH[r.status] ?? r.status}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <span className="inline-flex shrink-0 items-center rounded-md border border-zinc-700 bg-zinc-800/50 px-2 py-0.5 text-[11px] text-zinc-300">
                  {KIND_ZH[r.kind] ?? r.kind}
                </span>
                <span className="truncate text-[11px] text-zinc-500">{periodLabel(r.title)}</span>
              </div>

              <h3 className="mt-2 line-clamp-2 text-[14px] font-medium leading-relaxed text-zinc-100">{r.title}</h3>
              <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-zinc-400">
                {r.summary || (r.status === 'failed' ? '生成失败' : r.status === 'ready' ? '报告已生成' : '报告生成中...')}
              </p>

              {taskRef == null && (() => {
                const m = r.task_id?.match(/^report-schedule:(\d+)$/);
                if (!m) return null;
                const sid = Number(m[1]);
                return (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/tasks/${sid}`);
                    }}
                    title="查看所属任务"
                    className="mt-3 inline-flex w-fit items-center gap-1 rounded border border-zinc-700/60 bg-zinc-800/40 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-indigo-500/40 hover:text-indigo-300"
                  >
                    <CalendarClock size={10} /> {taskNames[sid] || '任务'}
                  </button>
                );
              })()}

              <div className="mt-auto flex items-center justify-between pt-3 text-[11px] text-zinc-500">
                <span>{r.generated_at ? relativeTime(r.generated_at) : relativeTime(r.created_at)}</span>
                <span className="inline-flex items-center gap-0.5 text-zinc-600 transition-colors group-hover:text-indigo-400">
                  查看 <ChevronRight size={12} />
                </span>
              </div>
            </article>
          ))}
        </div>
      )}

      {(page > 0 || items.length === PAGE_SIZE) && (
        <div className="flex items-center justify-end gap-2 py-3 text-xs text-zinc-400">
          <span className="mr-2 text-zinc-600">第 {page + 1} 页</span>
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 hover:bg-zinc-800 disabled:opacity-40"
          >
            <ChevronLeft size={13} /> 上一页
          </button>
          <button
            type="button"
            disabled={items.length < PAGE_SIZE}
            onClick={() => setPage((p) => p + 1)}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 hover:bg-zinc-800 disabled:opacity-40"
          >
            下一页 <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
