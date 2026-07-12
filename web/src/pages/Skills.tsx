import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Cloud,
  Cpu,
  Eye,
  Loader2,
  Play,
  Puzzle,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { listSkills, type SkillClass, type SkillParamDef, type SkillScope, type SkillSummary } from '@/api/skills';
import { listFlowTools, type FlowToolMeta } from '@/api/flows';
import { ApiError } from '@/api/client';
import { Modal } from '@/components/Modal';
import { useAuth } from '@/store/auth';
import { Button, Card, EmptyState, PageHeader } from '@/components/ui';

const InstallTab = lazy(() => import('@/pages/settings/Marketplace'));

type ScopeFilter = '' | SkillScope;
type RiskFilter = '' | SkillClass;
type Tab = 'catalog' | 'install';

export default function SkillsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = useAuth((s) => s.role) === 'admin';
  const tab: Tab = searchParams.get('tab') === 'install' && isAdmin ? 'install' : 'catalog';

  const setTab = (nextTab: Tab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextTab === 'install') next.set('tab', 'install');
      else next.delete('tab');
      return next;
    }, { replace: true });
  };

  return (
    <main className="anim-fade flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Skills 技能 / 工具"
        subtitle="Agent 和工作流可调用的能力清单，按运行位置、风险等级和人工确认要求治理。"
        extra={
          isAdmin ? (
            <div className="-mb-4 flex items-center gap-1">
              <TabButton active={tab === 'catalog'} onClick={() => setTab('catalog')} icon={<Wrench size={14} />} label="能力目录" />
              <TabButton active={tab === 'install'} onClick={() => setTab('install')} icon={<Puzzle size={14} />} label="扩展安装" />
            </div>
          ) : undefined
        }
      />
      {tab === 'install' ? (
        <div className="flex-1 overflow-auto px-6 py-4">
          <Suspense fallback={<div className="flex h-40 items-center justify-center text-sm text-zinc-500">加载中...</div>}>
            <InstallTab />
          </Suspense>
        </div>
      ) : (
        <CatalogTab />
      )}
    </main>
  );
}

function normalizeSkill(input: SkillSummary): SkillSummary {
  return {
    ...input,
    key: input.key || input.name || 'unknown_skill',
    name: input.name || input.key || '未命名 Skill',
    description: input.description || '',
    class: normalizeClass(input.class),
    scope: input.scope === 'manager' ? 'manager' : 'host',
    params: normalizeParams(input.params),
  };
}

function normalizeClass(value: unknown): SkillClass {
  if (value === 'mutating' || value === 'dangerous' || value === 'safe') return value;
  return 'safe';
}

function normalizeParams(value: unknown): SkillParamDef[] {
  return Array.isArray(value) ? value : [];
}

function mcpToSkill(t: FlowToolMeta): SkillSummary {
  return {
    key: t.name,
    name: t.display_zh || t.name,
    description: t.description_zh || t.description || '',
    class: t.class === 'read' ? 'safe' : t.class === 'destructive' ? 'dangerous' : 'mutating',
    scope: 'manager',
    category: t.category || 'mcp',
    params: [],
    source: 'mcp',
    inventory_only: true,
  };
}

function CatalogTab() {
  const [items, setItems] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<ScopeFilter>('');
  const [risk, setRisk] = useState<RiskFilter>('');
  const [viewing, setViewing] = useState<SkillSummary | null>(null);

  const fetchSkills = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [skillResp, flowToolResp] = await Promise.all([
        listSkills(),
        listFlowTools().catch(() => ({ items: [] as FlowToolMeta[] })),
      ]);
      const builtin = (skillResp.items ?? []).map(normalizeSkill);
      const mcp = (flowToolResp.items ?? [])
        .filter((tool) => tool.name.startsWith('mcp__'))
        .map((tool) => normalizeSkill(mcpToSkill(tool)));
      setItems([...builtin, ...mcp]);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchSkills();
  }, [fetchSkills]);

  const counts = useMemo(() => {
    const out = { total: items.length, host: 0, manager: 0, safe: 0, mutating: 0, dangerous: 0 };
    for (const skill of items) {
      if ((skill.scope ?? 'host') === 'manager') out.manager++;
      else out.host++;
      out[skill.class]++;
    }
    return out;
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((skill) => {
      if (scope && (skill.scope ?? 'host') !== scope) return false;
      if (risk && skill.class !== risk) return false;
      if (!q) return true;
      return (
        (skill.name || '').toLowerCase().includes(q) ||
        (skill.key || '').toLowerCase().includes(q) ||
        (skill.description || '').toLowerCase().includes(q) ||
        (skill.category || '').toLowerCase().includes(q)
      );
    });
  }, [items, query, risk, scope]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-zinc-800 px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative block w-72">
            <span className="sr-only">搜索</span>
            <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索名称 / key / 描述 / 分类"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950/40 py-1.5 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            <FilterChip active={scope === ''} onClick={() => setScope('')}>全部 {counts.total}</FilterChip>
            <FilterChip active={scope === 'host'} onClick={() => setScope('host')}>设备端 {counts.host}</FilterChip>
            <FilterChip active={scope === 'manager'} onClick={() => setScope('manager')}>云端 {counts.manager}</FilterChip>
          </div>
          <div className="flex flex-wrap gap-1">
            <FilterChip active={risk === ''} onClick={() => setRisk('')}>全部风险</FilterChip>
            <FilterChip active={risk === 'safe'} onClick={() => setRisk('safe')}>只读 {counts.safe}</FilterChip>
            <FilterChip active={risk === 'mutating'} onClick={() => setRisk('mutating')}>写操作 {counts.mutating}</FilterChip>
            <FilterChip active={risk === 'dangerous'} onClick={() => setRisk('dangerous')}>高风险 {counts.dangerous}</FilterChip>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-zinc-500">匹配 {filtered.length} / {items.length}</span>
            <Button variant="ghost" onClick={() => fetchSkills(true)} disabled={loading || refreshing}>
              <RefreshCw size={12} className={cn(refreshing && 'animate-spin')} />
              刷新
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {err && <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-300">加载失败：{err}</div>}
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-zinc-500">
            <Loader2 size={16} className="mr-2 animate-spin" />
            加载中...
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Wrench} title={items.length > 0 ? '没有匹配的 Skill' : '还没有 Skill 注册'} hint="Skill 会由内置能力、Edge 能力、MCP 工具或扩展包提供。" />
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {filtered.map((skill) => (
              <SkillCard key={skill.key} skill={skill} onView={() => setViewing(skill)} />
            ))}
          </div>
        )}
      </div>
      {viewing && <SkillDetailModal skill={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function SkillCard({ skill, onView }: { skill: SkillSummary; onView: () => void }) {
  const params = normalizeParams(skill.params);

  return (
    <Card interactive className="cursor-pointer" onClick={onView}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-zinc-100">{skill.name || skill.key}</span>
            {skill.inventory_only && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">AI 调用</span>}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">{skill.key}</div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <ScopeBadge value={skill.scope ?? 'host'} />
          <ClassBadge value={skill.class} />
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-zinc-400">{skill.description || '未填写描述'}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
        <GovernanceBadge skill={skill} />
        {skill.category && <span className="rounded border border-zinc-800 bg-zinc-950/40 px-1.5 py-0.5">{skill.category}</span>}
        <span>{params.length} 个参数</span>
        <span className="ml-auto">
          {skill.inventory_only ? (
            <span className="text-zinc-500">由 Agent / Workflow 调用</span>
          ) : (
            <Link
              to={`/skills/${encodeURIComponent(skill.key)}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
            >
              <Play size={11} />
              手动执行
            </Link>
          )}
        </span>
      </div>
    </Card>
  );
}

function SkillDetailModal({ skill, onClose }: { skill: SkillSummary; onClose(): void }) {
  const params = normalizeParams(skill.params);

  return (
    <Modal open onClose={onClose} size="lg" resizable title={skill.name || skill.key}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ScopeBadge value={skill.scope ?? 'host'} />
          <ClassBadge value={skill.class} />
          <GovernanceBadge skill={skill} />
          {skill.category && <span className="rounded-md border border-zinc-800 bg-zinc-950/40 px-1.5 py-0.5 text-[10px] text-zinc-400">{skill.category}</span>}
          <span className="ml-auto font-mono text-[11px] text-zinc-500">{skill.key}</span>
        </div>
        <section>
          <div className="mb-1.5 text-[11px] uppercase tracking-wider text-zinc-500">说明</div>
          <div className="whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs leading-relaxed text-zinc-300">
            {skill.description || '未填写描述'}
          </div>
        </section>
        <section>
          <div className="mb-1.5 text-[11px] uppercase tracking-wider text-zinc-500">参数</div>
          {params.length === 0 ? (
            <div className="text-xs text-zinc-500">{skill.inventory_only ? '参数来自原始 JSON Schema，通常由 Agent 在 chat 或 workflow 中调用。' : '无参数'}</div>
          ) : (
            <div className="overflow-hidden rounded-md border border-zinc-800">
              <table className="w-full text-xs">
                <thead className="border-b border-zinc-800 bg-zinc-950/40 text-[10px] uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-3 py-1.5 text-left">名称</th>
                    <th className="px-3 py-1.5 text-left">类型</th>
                    <th className="px-3 py-1.5 text-left">必填</th>
                    <th className="px-3 py-1.5 text-left">说明</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {params.map((param) => (
                    <tr key={param.name}>
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-zinc-200">{param.name}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-zinc-400">{param.type}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-zinc-400">{param.required ? '是' : '-'}</td>
                      <td className="px-3 py-1.5 text-zinc-400">{param.desc || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 pt-3">
          <span className="text-[11px] text-zinc-500">Skill 由代码、Edge 能力、MCP 或扩展包注册；写操作和高风险动作应进入人工确认。</span>
          {!skill.inventory_only && (
            <Link
              to={`/skills/${encodeURIComponent(skill.key)}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white"
            >
              <Play size={11} />
              手动执行
            </Link>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function ScopeBadge({ value }: { value: SkillScope }) {
  const isHost = value === 'host';
  return (
    <span
      title={isHost ? '在设备端 Edge 上执行，需要选择资产。' : '在 Manager 云端执行，不需要选择资产。'}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset',
        isHost ? 'bg-sky-500/10 text-sky-300 ring-sky-500/30' : 'bg-violet-500/10 text-violet-300 ring-violet-500/30',
      )}
    >
      {isHost ? <Cpu size={10} /> : <Cloud size={10} />}
      {isHost ? '设备端' : '云端'}
    </span>
  );
}

export function ClassBadge({ value }: { value: SkillClass }) {
  const styles: Record<SkillClass, string> = {
    safe: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
    mutating: 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
    dangerous: 'bg-red-500/15 text-red-300 ring-red-500/40',
  };
  const labels: Record<SkillClass, string> = {
    safe: '只读',
    mutating: '写操作',
    dangerous: '高风险',
  };
  const Icon = value === 'safe' ? Eye : value === 'mutating' ? ShieldAlert : ShieldCheck;
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset', styles[value])}>
      <Icon size={10} />
      {labels[value]}
    </span>
  );
}

function GovernanceBadge({ skill }: { skill: SkillSummary }) {
  if (skill.class === 'safe') {
    return <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">无需人工确认</span>;
  }
  if (skill.class === 'mutating') {
    return <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">建议人工确认</span>;
  }
  return <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-300">必须人工确认</span>;
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-2 py-1 text-xs transition-colors',
        active ? 'border-zinc-600 bg-zinc-800 text-zinc-100' : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
      )}
    >
      {children}
    </button>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
        active ? 'border-indigo-500 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
