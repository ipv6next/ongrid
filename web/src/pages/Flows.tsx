import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  FileText,
  GitBranch,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Route as WorkflowIcon,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';

import {
  createFlow,
  deleteFlow,
  generateFlow,
  listFlows,
  runFlow,
  toggleFlow,
  type Flow,
  type FlowGraph,
} from '@/api/flows';
import { useAuth } from '@/store/auth';
import { PageHeader, Button, Card, EmptyState } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { cn } from '@/lib/cn';

type WorkflowKind = 'all' | 'alert' | 'patrol' | 'report' | 'approval' | 'manual';

type FlowTemplate = {
  key: string;
  kind: Exclude<WorkflowKind, 'all'>;
  name: string;
  description: string;
  graph: FlowGraph;
};

const KIND_LABEL: Record<WorkflowKind, string> = {
  all: '全部',
  alert: '告警',
  patrol: '巡检',
  report: '报告',
  approval: '人工确认',
  manual: '手动',
};

const KIND_TONE: Record<Exclude<WorkflowKind, 'all'>, string> = {
  alert: 'bg-red-500/10 text-red-300 ring-red-500/30',
  patrol: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
  report: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
  approval: 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
  manual: 'bg-zinc-700/60 text-zinc-300 ring-zinc-600/50',
};

const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    key: 'alert-auto-investigation',
    kind: 'alert',
    name: '告警自动调查',
    description: '[类型:告警] 监控告警或手动输入 incident_id 后，由 RCA Agent 拉取事件详情并生成根因、证据和建议动作。',
    graph: {
      nodes: [
        { id: 'alert', type: 'trigger.alert_fired', name: '告警触发', config: {}, position: { x: 80, y: 100 } },
        { id: 'manual', type: 'trigger.manual', name: '手动触发', config: {}, position: { x: 80, y: 230 } },
        {
          id: 'rca',
          type: 'agent',
          name: 'RCA 调查',
          config: {
            persona: 'incident-investigator',
            instruction:
              '请调查 incident_id={{trigger.incident_id}} 的告警。先获取事件详情，再关联指标、日志、Trace 和 Edge 上下文，输出根因判断、证据链、影响范围、建议动作和是否需要人工确认。',
          },
          position: { x: 340, y: 160 },
        },
      ],
      edges: [
        { id: 'e-alert-rca', source: 'alert', sourcePort: 'next', target: 'rca' },
        { id: 'e-manual-rca', source: 'manual', sourcePort: 'next', target: 'rca' },
      ],
    },
  },
  {
    key: 'high-risk-approval',
    kind: 'approval',
    name: '高风险动作人工确认',
    description: '[类型:人工确认] 对 RCA 或 Skill 产生的变更建议进行二审，默认先评估风险，再进入人工确认。',
    graph: {
      nodes: [
        { id: 'manual', type: 'trigger.manual', name: '手动触发', config: {}, position: { x: 80, y: 160 } },
        {
          id: 'review',
          type: 'agent',
          name: 'Reviewer 二审',
          config: {
            persona: 'reviewer',
            instruction:
              '请评估本次建议动作的风险。事件={{trigger.incident_id}}，动作={{trigger.action}}，payload={{trigger.payload}}。输出风险等级、是否建议批准、需要人工确认的理由和回滚注意事项。',
          },
          position: { x: 340, y: 160 },
        },
      ],
      edges: [{ id: 'e-manual-review', source: 'manual', sourcePort: 'next', target: 'review' }],
    },
  },
  {
    key: 'patrol-risk-report',
    kind: 'patrol',
    name: '巡检风险生成报告',
    description: '[类型:巡检] 巡检发现风险后，汇总风险项、影响资产、整改建议，并生成可归档的巡检报告素材。',
    graph: {
      nodes: [
        { id: 'manual', type: 'trigger.manual', name: '巡检完成', config: {}, position: { x: 80, y: 160 } },
        {
          id: 'report',
          type: 'agent',
          name: '巡检报告整理',
          config: {
            persona: 'reporter',
            instruction:
              '请根据巡检结果生成安全巡检报告素材。资产={{trigger.device_name}}，风险项={{trigger.findings}}。输出风险摘要、整改优先级、建议动作和复查建议。',
          },
          position: { x: 340, y: 160 },
        },
      ],
      edges: [{ id: 'e-manual-report', source: 'manual', sourcePort: 'next', target: 'report' }],
    },
  },
  {
    key: 'rca-archive-report',
    kind: 'report',
    name: 'RCA 归档报告',
    description: '[类型:报告] 将事件调查结果整理成 RCA 报告材料，便于复制、导出、复盘和周/月报汇总。',
    graph: {
      nodes: [
        { id: 'manual', type: 'trigger.manual', name: 'RCA 完成', config: {}, position: { x: 80, y: 160 } },
        {
          id: 'archive',
          type: 'agent',
          name: '报告归档',
          config: {
            persona: 'reporter',
            instruction:
              '请把 incident_id={{trigger.incident_id}} 的 RCA 调查结果整理成归档报告。包含事件背景、时间线、根因、证据、处置动作、遗留风险和复盘建议。',
          },
          position: { x: 340, y: 160 },
        },
      ],
      edges: [{ id: 'e-manual-archive', source: 'manual', sourcePort: 'next', target: 'archive' }],
    },
  },
];

export default function FlowsPage() {
  const navigate = useNavigate();
  const role = useAuth((s) => s.role);
  const canWrite = role !== 'viewer';

  const [items, setItems] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<WorkflowKind>('all');

  const refresh = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const r = await listFlows({ limit: 100 });
      setItems(r.items ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((f) => {
      const inferred = inferWorkflowKind(f);
      if (kind !== 'all' && inferred !== kind) return false;
      if (!q) return true;
      return f.name.toLowerCase().includes(q) || (f.description ?? '').toLowerCase().includes(q);
    });
  }, [items, kind, search]);

  const onRun = async (f: Flow) => {
    const input: Record<string, unknown> = {};
    const requiredFields = requiredTriggerFields(f);
    for (const field of requiredFields) {
      if (field === 'action') {
        input.action = '从事件 RCA Suggested Action 自动读取';
        continue;
      }
      if (field === 'payload') {
        input.payload = { source: 'incident_rca', incident_id: input.incident_id ?? null };
        continue;
      }
      const raw = window.prompt(triggerFieldPrompt(field));
      if (raw === null) return;
      if (!raw.trim()) {
        setError(`运行已取消：缺少必填触发参数 ${field}`);
        return;
      }
      if (field === 'incident_id') {
        const id = Number(raw.trim());
        if (!Number.isInteger(id) || id <= 0) {
          setError('incident_id 必须是大于 0 的事件编号');
          return;
        }
        input[field] = id;
      } else {
        input[field] = raw.trim();
      }
    }
    if (input.payload && typeof input.payload === 'object') {
      input.payload = { ...(input.payload as Record<string, unknown>), incident_id: input.incident_id ?? null };
    }
    setBusyId(f.id);
    setNotice('');
    try {
      const run = await runFlow(f.id, input);
      setNotice(`已触发工作流运行 ${run.id.slice(0, 8)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onToggle = async (f: Flow) => {
    setBusyId(f.id);
    try {
      await toggleFlow(f.id, !f.enabled);
      await refresh(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (f: Flow) => {
    if (!window.confirm(`删除工作流「${f.name}」？运行历史仍会保留。`)) return;
    setBusyId(f.id);
    try {
      await deleteFlow(f.id);
      await refresh(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="anim-fade flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="编排 / 自动化"
        subtitle={`把事件、Agent、Skill、人工确认和报告串成安全运维闭环，共 ${items.length} 个工作流`}
        actions={
          <>
            <Button onClick={() => refresh(true)} disabled={loading || refreshing} variant="ghost">
              <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
              刷新
            </Button>
            {canWrite && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus size={14} />
                新建工作流
              </Button>
            )}
          </>
        }
      />

      <div className="border-b border-zinc-800 px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative block w-72">
            <span className="sr-only">搜索</span>
            <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索工作流名称 / 描述"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950/40 py-1.5 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {(['all', 'alert', 'patrol', 'approval', 'report', 'manual'] as WorkflowKind[]).map((k) => (
              <FilterChip key={k} active={kind === k} onClick={() => setKind(k)}>
                {KIND_LABEL[k]}
              </FilterChip>
            ))}
          </div>
          <span className="ml-auto text-xs text-zinc-500">
            匹配 {shown.length} / {items.length}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {error && (
          <div className="mb-4 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</div>
        )}
        {notice && (
          <div className="mb-4 rounded-md border border-emerald-800/50 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">{notice}</div>
        )}

        <TemplateStrip
          canWrite={canWrite}
          onCreated={async (flow) => {
            setNotice(`已创建模板工作流「${flow.name}」`);
            await refresh(true);
          }}
          onError={setError}
        />

        {loading ? (
          <div className="flex h-44 items-center justify-center text-sm text-zinc-500">
            <Loader2 size={16} className="mr-2 animate-spin" />
            加载中...
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={WorkflowIcon}
            title={items.length === 0 ? '还没有工作流' : '没有匹配的工作流'}
            hint={items.length === 0 ? '可以先从上方模板创建告警调查、人工确认或报告归档流程。' : '换个关键字或清除类型筛选。'}
          />
        ) : (
          <div className="space-y-2">
            {shown.map((f) => (
              <FlowRow
                key={f.id}
                flow={f}
                busy={busyId === f.id}
                canWrite={canWrite}
                onOpen={() => navigate(`/workflows/${f.id}`)}
                onRun={() => void onRun(f)}
                onToggle={() => void onToggle(f)}
                onDelete={() => void onDelete(f)}
              />
            ))}
          </div>
        )}
      </div>

      <CreateFlowModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => navigate(`/workflows/${id}`)}
      />
    </main>
  );
}

function TemplateStrip({
  canWrite,
  onCreated,
  onError,
}: {
  canWrite: boolean;
  onCreated: (flow: Flow) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [busyKey, setBusyKey] = useState('');

  const createTemplate = async (tpl: FlowTemplate) => {
    if (!canWrite || busyKey) return;
    setBusyKey(tpl.key);
    try {
      const flow = await createFlow({ name: tpl.name, description: tpl.description, graph: tpl.graph });
      await onCreated(flow);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-4">
      {FLOW_TEMPLATES.map((tpl) => {
        const Icon = templateIcon(tpl.kind);
        return (
          <Card key={tpl.key} compact className="flex flex-col gap-3">
            <div className="flex items-start gap-2">
              <span className="rounded-md border border-zinc-800 bg-zinc-950/40 p-2 text-zinc-300">
                <Icon size={15} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-zinc-100">{tpl.name}</div>
                <div className="mt-0.5">
                  <KindBadge kind={tpl.kind} />
                </div>
              </div>
            </div>
            <p className="line-clamp-3 min-h-[48px] text-xs leading-relaxed text-zinc-500">
              {tpl.description.replace(/^\[类型:[^\]]+\]\s*/, '')}
            </p>
            <Button
              variant="ghost"
              disabled={!canWrite || Boolean(busyKey)}
              onClick={() => void createTemplate(tpl)}
              className="justify-center"
            >
              {busyKey === tpl.key ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              使用模板
            </Button>
          </Card>
        );
      })}
    </div>
  );
}

function FlowRow({
  flow,
  busy,
  canWrite,
  onOpen,
  onRun,
  onToggle,
  onDelete,
}: {
  flow: Flow;
  busy: boolean;
  canWrite: boolean;
  onOpen: () => void;
  onRun: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const kind = inferWorkflowKind(flow);
  const Icon = templateIcon(kind);
  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 transition-colors hover:border-zinc-700"
      onClick={onOpen}
    >
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
          flow.enabled
            ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300'
            : 'border-zinc-800 bg-zinc-900 text-zinc-600',
        )}
      >
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-100">{flow.name}</span>
          <span className="shrink-0 rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-500">v{flow.version}</span>
          <KindBadge kind={kind} />
          {flow.enabled ? (
            <span className="shrink-0 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300 ring-1 ring-inset ring-emerald-500/30">已启用 · 等待触发</span>
          ) : (
            <span className="shrink-0 rounded-md bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">停用</span>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-zinc-500">{flow.description || '未填写描述'}</div>
      </div>
      <div className="hidden shrink-0 items-center gap-3 text-[11px] text-zinc-500 md:flex">
        <span>{triggerLabel(flow.trigger_type)}</span>
        <span className="tabular-nums">{flow.node_count ?? 0} 节点</span>
        <span className="whitespace-nowrap tabular-nums">{relativeTime(flow.updated_at)}</span>
      </div>
      {canWrite && (
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton title="运行" disabled={busy || !flow.enabled} onClick={onRun}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          </IconButton>
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            className="rounded-md px-2 py-1 text-[12px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
          >
            {flow.enabled ? '停用' : '启用'}
          </button>
          <IconButton title="删除" disabled={busy} onClick={onDelete} danger>
            <Trash2 size={15} />
          </IconButton>
        </div>
      )}
    </div>
  );
}

function CreateFlowModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [mode, setMode] = useState<'ai' | 'blank'>('ai');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!open) return null;

  const canSubmit = mode === 'ai' ? prompt.trim().length >= 5 : name.trim().length > 0;
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr('');
    try {
      const f = mode === 'ai'
        ? await generateFlow(prompt.trim())
        : await createFlow({
            name: name.trim(),
            description: '[类型:手动] 空白工作流，可在编辑器中添加触发、Agent、Skill 和通知节点。',
            graph: { nodes: [{ id: 'manual', type: 'trigger.manual', name: '手动触发', position: { x: 80, y: 160 } }], edges: [] },
          });
      onCreated(f.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="新建工作流"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit || busy}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : mode === 'ai' ? <Sparkles size={12} /> : <Plus size={12} />}
            {busy ? '处理中...' : mode === 'ai' ? 'AI 生成' : '创建'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="inline-flex rounded-md border border-zinc-800 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode('ai')}
            className={cn('rounded px-3 py-1 transition-colors', mode === 'ai' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200')}
          >
            AI 生成
          </button>
          <button
            type="button"
            onClick={() => setMode('blank')}
            className={cn('rounded px-3 py-1 transition-colors', mode === 'blank' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200')}
          >
            空白画布
          </button>
        </div>
        {mode === 'ai' ? (
          <label className="block">
            <span className="mb-1 block text-[11px] text-zinc-400">用一句话描述安全运维流程，AI 会生成可编辑的节点图。</span>
            <textarea
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="例如：告警触发后让 RCA Agent 调查，若建议重启服务则进入人工确认，再生成 RCA 报告。"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[13px] text-zinc-200 outline-none focus:border-zinc-600"
            />
          </label>
        ) : (
          <label className="block">
            <span className="mb-1 block text-[11px] text-zinc-400">工作流名称</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              placeholder="例如：数据库告警处置流程"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[13px] text-zinc-200 outline-none focus:border-zinc-600"
            />
          </label>
        )}
        {err && <div className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">{err}</div>}
      </div>
    </Modal>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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

function KindBadge({ kind }: { kind: Exclude<WorkflowKind, 'all'> }) {
  return (
    <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10px] ring-1 ring-inset', KIND_TONE[kind])}>
      {KIND_LABEL[kind]}
    </span>
  );
}

function IconButton({
  title,
  disabled,
  danger,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 disabled:opacity-40',
        danger ? 'hover:text-red-400' : 'hover:text-indigo-300',
      )}
    >
      {children}
    </button>
  );
}

function inferWorkflowKind(flow: Flow): Exclude<WorkflowKind, 'all'> {
  const text = `${flow.name} ${flow.description} ${flow.trigger_type}`.toLowerCase();
  if (text.includes('[类型:人工确认]') || /approval|确认|审批|review/.test(text)) return 'approval';
  if (text.includes('[类型:巡检]') || /patrol|巡检/.test(text)) return 'patrol';
  if (text.includes('[类型:报告]') || /report|报告|归档|复盘/.test(text)) return 'report';
  if (text.includes('[类型:告警]') || flow.trigger_type === 'trigger.alert_fired' || /alert|incident|告警|事件|rca/.test(text)) return 'alert';
  return 'manual';
}

function requiredTriggerFields(flow: Flow): string[] {
  const text = `${flow.description || ''}\n${JSON.stringify(flow.graph || {})}`;
  const fields = new Set<string>();
  for (const match of text.matchAll(/\{\{\s*trigger\.([a-zA-Z0-9_]+)[^}]*\}\}/g)) {
    fields.add(match[1]);
  }
  if (/incident_id/.test(flow.description || '')) fields.add('incident_id');
  return [...fields];
}

function triggerFieldPrompt(field: string): string {
  if (field === 'incident_id') return '请输入事件编号 incident_id（可在事件列表或事件详情地址中查看）';
  if (field === 'action') return '请输入需要评估的建议动作';
  if (field === 'payload') return '请输入动作 payload（支持 JSON 或文本）';
  return `请输入触发参数 ${field}`;
}

function triggerLabel(t?: string) {
  switch (t) {
    case 'trigger.manual':
      return '手动触发';
    case 'trigger.cron':
      return '定时触发';
    case 'trigger.alert_fired':
      return '告警触发';
    default:
      return t ? t.replace('trigger.', '') : '未识别触发';
  }
}

function templateIcon(kind: Exclude<WorkflowKind, 'all'>) {
  switch (kind) {
    case 'alert':
      return AlertTriangle;
    case 'patrol':
      return ShieldCheck;
    case 'report':
      return FileText;
    case 'approval':
      return CheckCircle2;
    default:
      return GitBranch;
  }
}

function relativeTime(iso: string) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '-';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  return `${day} 天前`;
}
