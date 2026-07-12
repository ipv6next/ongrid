import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import {
  applyEdgeSecurityPolicy,
  getEdgeSecurityPolicy,
  listEdges,
  type Edge,
  type EdgeSecurityPolicy,
} from '@/api/edges';
import { ApiError } from '@/api/client';
import { cn } from '@/lib/cn';

type PolicyRow = {
  edge: Edge;
  policy?: EdgeSecurityPolicy;
  error?: string;
};

export default function EdgeSecurityPage() {
  const [rows, setRows] = useState<PolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const edges = (await listEdges()).items ?? [];
      const results = await Promise.all(
        edges.map(async (edge): Promise<PolicyRow> => {
          if (edge.status !== 'online') return { edge, error: 'Edge 离线' };
          try {
            return { edge, policy: await getEdgeSecurityPolicy(edge.id) };
          } catch (e) {
            return {
              edge,
              error: e instanceof ApiError ? e.message : (e as Error).message,
            };
          }
        }),
      );
      setRows(results);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (row: PolicyRow) => {
    if (!row.policy || row.edge.status !== 'online') return;
    setBusy(row.edge.id);
    setError(null);
    try {
      const policy = await applyEdgeSecurityPolicy(row.edge.id, !row.policy.enabled);
      setRows((current) =>
        current.map((item) => (item.edge.id === row.edge.id ? { ...item, policy, error: undefined } : item)),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="anim-fade flex flex-1 flex-col overflow-hidden">
      <header className="app-header border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
              <ShieldCheck size={17} className="text-emerald-400" /> Edge 安全策略
            </h1>
            <p className="mt-1 text-xs text-zinc-500">向 Edge 下发受控命令策略预设，热更新并记录审计。</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            <RefreshCw size={12} className={cn(loading && 'animate-spin')} /> 刷新
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {error && <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
        <div className="overflow-hidden rounded-md border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950 text-left text-[11px] text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Edge</th>
                <th className="px-4 py-2 font-medium">连接</th>
                <th className="px-4 py-2 font-medium">策略预设</th>
                <th className="px-4 py-2 font-medium">运行环境</th>
                <th className="px-4 py-2 font-medium">最后应用</th>
                <th className="px-4 py-2 text-right font-medium">启用</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.edge.id} className="border-t border-zinc-800/80">
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-100">{row.edge.name}</div>
                    <div className="text-[11px] text-zinc-500">Edge #{row.edge.id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs', row.edge.status === 'online' ? 'text-emerald-300' : 'text-zinc-500')}>
                      {row.edge.status === 'online' ? '在线' : '离线'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-zinc-200">Docker 只读巡检</div>
                    <div className="text-[11px] text-zinc-500">仅允许状态、日志、资源、网络和 Compose 查询</div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {row.error ? (
                      <span className="inline-flex items-center gap-1 text-amber-300"><TriangleAlert size={12} /> {row.error}</span>
                    ) : row.policy?.docker_available ? (
                      <span className="text-emerald-300">已检测到 Docker CLI</span>
                    ) : (
                      <span className="text-amber-300">未检测到 Docker CLI</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {row.policy?.applied_at ? new Date(row.policy.applied_at).toLocaleString('zh-CN') : '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={Boolean(row.policy?.enabled)}
                      disabled={!row.policy || busy === row.edge.id}
                      onClick={() => void toggle(row)}
                      className={cn(
                        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40',
                        row.policy?.enabled ? 'bg-emerald-500' : 'bg-zinc-700',
                      )}
                    >
                      <span className={cn('h-4 w-4 rounded-full bg-white transition-transform', row.policy?.enabled ? 'translate-x-4' : 'translate-x-0.5')} />
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-zinc-500">暂无 Edge</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
