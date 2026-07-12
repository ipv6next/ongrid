import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  Copy,
  HardDrive,
  MessageSquarePlus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Modal } from '@/components/Modal';
import { Button, Card, EmptyState, PageHeader } from '@/components/ui';
import {
  createUserAgent,
  deleteAgent,
  listAgents,
  updateUserAgent,
  type AgentSource,
  type AgentSummary,
  type UserAgentInput,
} from '@/api/agents';
import { listSkills, type SkillSummary } from '@/api/skills';
import { createSession } from '@/api/chat';
import { ApiError } from '@/api/client';

const AGENT_PROFILE: Record<string, { label: string; role: string; domain: string; risk: string }> = {
  default: {
    label: 'Coordinator 协调员',
    role: '统一入口，负责理解问题、选择工具、必要时派发 specialist 子 Agent。',
    domain: '通用分析 / 编排派活',
    risk: '按工具风险继承',
  },
  'incident-investigator': {
    label: 'RCA 调查专家',
    role: '围绕单个事件做指标、日志、Trace、Edge 上下文关联，输出根因、证据和建议动作。',
    domain: '事件 / 告警 / RCA',
    risk: '只读优先',
  },
  'specialist-sre': {
    label: 'SRE 专家',
    role: '判断系统健康度、告警优先级、SLO/趋势异常和影响范围。',
    domain: '可用性 / 稳定性',
    risk: '只读优先',
  },
  'specialist-ops': {
    label: '运维专家',
    role: '分析服务状态、进程、计划任务、配置和处置建议；涉及变更时进入二审。',
    domain: '主机运维 / 服务处置',
    risk: '变更需确认',
  },
  'specialist-compute': {
    label: '计算资源专家',
    role: '定位 CPU、内存、load、OOM、调度等计算资源问题。',
    domain: 'CPU / 内存 / 进程',
    risk: '只读优先',
  },
  'specialist-network': {
    label: '网络专家',
    role: '排查 DNS、路由、iptables、conntrack、TLS、MTU、OVS 等网络问题。',
    domain: '网络 / 连通性',
    risk: '只读优先',
  },
  'specialist-disk': {
    label: '磁盘专家',
    role: '排查磁盘空间、inode、I/O、文件系统异常和大文件风险。',
    domain: '磁盘 / 文件系统',
    risk: '只读优先',
  },
  'specialist-container': {
    label: '容器运维专家',
    role: '排查 Docker 容器状态、日志、健康检查、资源占用、网络、挂载、镜像和 Compose 服务异常。',
    domain: 'Docker / 容器 / Compose',
    risk: '只读优先',
  },
  reviewer: {
    label: 'Reviewer 审核员',
    role: '对重启、变更、删除等高风险动作做二审，给出批准/拒绝建议和风险说明。',
    domain: '高风险动作治理',
    risk: '人工确认',
  },
  reporter: {
    label: '报告撰写专家',
    role: '把事件、巡检和运维事实整理成 RCA、巡检或周/月报材料。',
    domain: '报告 / 复盘',
    risk: '只读',
  },
};

const BUILTIN_ORDER = [
  'default',
  'incident-investigator',
  'specialist-sre',
  'specialist-ops',
  'specialist-compute',
  'specialist-network',
  'specialist-disk',
  'specialist-container',
  'reviewer',
  'reporter',
];

export default function AgentsPage() {
  const [items, setItems] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<
    | { mode: 'create'; seed?: AgentSummary }
    | { mode: 'edit'; agent: AgentSummary }
    | null
  >(null);
  const [deleting, setDeleting] = useState<AgentSummary | null>(null);
  const [viewing, setViewing] = useState<AgentSummary | null>(null);

  const fetchAgents = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const r = await listAgents();
      setItems(r.items ?? []);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = !q
      ? items
      : items.filter((a) => {
          const p = profileOf(a);
          return (
            a.name.toLowerCase().includes(q) ||
            p.label.toLowerCase().includes(q) ||
            p.role.toLowerCase().includes(q) ||
            p.domain.toLowerCase().includes(q) ||
            (a.description ?? '').toLowerCase().includes(q)
          );
        });
    return [...matched].sort((a, b) => builtinRank(a.name) - builtinRank(b.name) || a.name.localeCompare(b.name));
  }, [items, query]);

  return (
    <main className="anim-fade flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Agent 助理 / 专家"
        subtitle={`用于事件调查、资源诊断、人工二审和报告复盘的 AI 专家库，共 ${items.length} 个`}
        actions={
          <>
            <Button onClick={() => fetchAgents(true)} disabled={loading || refreshing} variant="ghost">
              <RefreshCw size={12} className={cn(refreshing && 'animate-spin')} />
              刷新
            </Button>
            <Button onClick={() => setEditing({ mode: 'create' })} variant="primary">
              <Plus size={12} />
              新建 Agent
            </Button>
          </>
        }
      />

      <div className="border-b border-zinc-800/60 px-6 py-2.5">
        <label className="relative block w-80">
          <span className="sr-only">搜索</span>
          <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 Agent 名称 / 定位 / 领域"
            className="w-full rounded-md border border-zinc-800/60 bg-zinc-950/40 py-1.5 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {err && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            加载失败：{err}
          </div>
        )}
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-zinc-500">加载中...</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title={items.length > 0 ? '没有匹配的 Agent' : '还没有 Agent 注册'}
            hint={items.length > 0 ? '换个关键字再试。' : '内置 Agent 会在服务启动时加载，也可以创建自定义 Agent。'}
            action={
              items.length === 0 ? (
                <Button variant="primary" onClick={() => setEditing({ mode: 'create' })}>
                  <Plus size={12} />
                  新建 Agent
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((a) => (
              <AgentCard
                key={a.name}
                agent={a}
                onView={() => setViewing(a)}
                onEdit={() => setEditing({ mode: 'edit', agent: a })}
                onDelete={() => setDeleting(a)}
              />
            ))}
          </div>
        )}
      </div>

      {viewing && (
        <AgentDetailModal
          agent={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            const a = viewing;
            setViewing(null);
            setEditing({ mode: 'edit', agent: a });
          }}
          onFork={() => {
            const a = viewing;
            setViewing(null);
            setEditing({ mode: 'create', seed: a });
          }}
        />
      )}
      {editing && (
        <AgentEditor
          mode={editing.mode}
          existing={editing.mode === 'edit' ? editing.agent : null}
          seed={editing.mode === 'create' ? editing.seed : undefined}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void fetchAgents(true);
          }}
        />
      )}
      {deleting && (
        <DeleteAgentDialog
          agent={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            setDeleting(null);
            void fetchAgents(true);
          }}
        />
      )}
    </main>
  );
}

function AgentCard({
  agent,
  onView,
  onEdit,
  onDelete,
}: {
  agent: AgentSummary;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const p = profileOf(agent);
  const toolCount = agent.tools?.length ?? 0;
  const isUser = agent.source === 'user';
  const canDelete = agent.source !== 'builtin' && agent.name !== 'default';

  const onUse = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const session = await createSession({ title: `使用 ${p.label}`, agent_id: agent.name });
      navigate(`/chat/${session.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
      setBusy(false);
    }
  }, [agent.name, busy, navigate, p.label]);

  return (
    <Card interactive className="flex cursor-pointer flex-col" onClick={onView}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-indigo-500/20 text-indigo-300 ring-1 ring-inset ring-indigo-500/40">
            {agent.name.includes('disk') ? <HardDrive size={15} /> : agent.name === 'reviewer' ? <ShieldCheck size={15} /> : <Bot size={15} />}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-zinc-100" title={agent.name}>{p.label}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
              <span className="font-mono text-zinc-600">{agent.name}</span>
              <span>·</span>
              <SourceLabel source={agent.source} />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isUser && (
            <SmallIcon title="编辑" onClick={onEdit}>
              <Pencil size={11} />
            </SmallIcon>
          )}
          {canDelete && (
            <SmallIcon title="删除" onClick={onDelete} danger>
              <Trash2 size={11} />
            </SmallIcon>
          )}
        </div>
      </div>
      {err && <div className="mt-2 text-[11px] text-red-300">{err}</div>}
      <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-zinc-400">{p.role}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Tag>{p.domain}</Tag>
        <Tag tone={p.risk === '人工确认' || p.risk === '变更需确认' ? 'warn' : 'ok'}>{p.risk}</Tag>
        <Tag>{toolCount > 0 ? `${toolCount} 个工具` : '继承工具'}</Tag>
      </div>
      <Button
        variant="ghost"
        disabled={busy}
        className="mt-4 justify-center"
        onClick={(e) => {
          e.stopPropagation();
          void onUse();
        }}
      >
        <MessageSquarePlus size={12} />
        {busy ? '创建中...' : '使用此 Agent'}
      </Button>
    </Card>
  );
}

function AgentDetailModal({
  agent,
  onClose,
  onEdit,
  onFork,
}: {
  agent: AgentSummary;
  onClose: () => void;
  onEdit: () => void;
  onFork: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const p = profileOf(agent);
  const isUser = agent.source === 'user';

  const onUse = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const session = await createSession({ title: `使用 ${p.label}`, agent_id: agent.name });
      navigate(`/chat/${session.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
      setBusy(false);
    }
  }, [agent.name, busy, navigate, p.label]);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      resizable
      title={p.label}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>关闭</Button>
          {isUser ? (
            <Button variant="ghost" onClick={onEdit}><Pencil size={11} />编辑</Button>
          ) : (
            <Button variant="ghost" onClick={onFork}><Copy size={11} />复制为自定义 Agent</Button>
          )}
          <Button variant="subtle" onClick={() => void onUse()} disabled={busy}>
            <MessageSquarePlus size={11} />
            {busy ? '创建中...' : '使用此 Agent'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <div className="text-[11px] text-red-300">{err}</div>}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
          <span className="font-mono text-zinc-400">{agent.name}</span>
          <span>·</span>
          <SourceLabel source={agent.source} />
          <Tag>{p.domain}</Tag>
          <Tag tone={p.risk === '人工确认' || p.risk === '变更需确认' ? 'warn' : 'ok'}>{p.risk}</Tag>
          <span className="ml-auto">{agent.tools?.length ? `${agent.tools.length} 个工具` : '继承全部工具'}</span>
        </div>

        <DetailSection label="产品定位">
          <p className="text-xs leading-relaxed text-zinc-300">{p.role}</p>
        </DetailSection>

        <DetailSection label="原始描述">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">{agent.description || '未填写'}</p>
        </DetailSection>

        {agent.when_to_use && (
          <DetailSection label="何时使用">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">{agent.when_to_use}</p>
          </DetailSection>
        )}

        <DetailSection label="系统提示词">
          {agent.system_prompt ? (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950/40 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
              {agent.system_prompt}
            </pre>
          ) : (
            <p className="text-xs text-zinc-500">继承 coordinator 默认提示词</p>
          )}
        </DetailSection>

        <DetailSection label="允许使用的工具">
          {agent.tools?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {agent.tools.map((t) => (
                <span key={t} className="rounded border border-zinc-800 bg-zinc-950/40 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                  {t}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">继承 coordinator 的全部工具</p>
          )}
        </DetailSection>
      </div>
    </Modal>
  );
}

function AgentEditor({
  mode,
  existing,
  seed,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  existing: AgentSummary | null;
  seed?: AgentSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const base = existing ?? seed ?? null;
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(base?.description ?? '');
  const [whenToUse, setWhenToUse] = useState(base?.when_to_use ?? '');
  const [systemPrompt, setSystemPrompt] = useState(base?.system_prompt ?? '');
  const [allowedTools, setAllowedTools] = useState<string[]>(base?.tools ?? []);
  const [model, setModel] = useState(base?.model ?? '');
  const [maxTurns, setMaxTurns] = useState<number>(base?.max_turns ?? 0);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void listSkills().then((r) => setSkills(r.items ?? [])).catch(() => setSkills([]));
  }, []);

  const submit = async () => {
    setErr(null);
    setSubmitting(true);
    try {
      const input: UserAgentInput = {
        name: mode === 'create' ? name.trim() : undefined,
        description: description.trim(),
        when_to_use: whenToUse.trim() || undefined,
        system_prompt: systemPrompt.trim(),
        allowed_tools: allowedTools.length > 0 ? allowedTools : undefined,
        model: model.trim() || undefined,
        max_turns: maxTurns > 0 ? maxTurns : undefined,
      };
      if (mode === 'create') await createUserAgent(input);
      else await updateUserAgent(existing!.name, input);
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTool = (key: string) => {
    setAllowedTools((cur) => cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'edit' ? `编辑 ${existing?.name}` : seed ? `基于 ${seed.name} 新建 Agent` : '新建 Agent'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            variant="subtle"
            onClick={() => void submit()}
            disabled={submitting || (mode === 'create' && name.trim() === '') || description.trim() === '' || systemPrompt.trim() === ''}
          >
            {submitting ? '保存中...' : '保存'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-xs text-zinc-300">
        {err && <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-red-300">{err}</div>}
        <Field label="名称" required>
          <input
            value={name}
            disabled={mode === 'edit'}
            onChange={(e) => setName(e.target.value)}
            placeholder="lower_snake 或 kebab-case，例如 security_reviewer"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100 disabled:opacity-50 focus:border-zinc-600 focus:outline-none"
            maxLength={64}
          />
          <div className="mt-1 text-[11px] text-zinc-500">创建后不能改名。</div>
        </Field>
        <Field label="描述" required>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="一句话说明这个 Agent 擅长什么"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-zinc-600 focus:outline-none"
            maxLength={512}
          />
        </Field>
        <Field label="何时使用">
          <textarea
            value={whenToUse}
            onChange={(e) => setWhenToUse(e.target.value)}
            placeholder="给 coordinator 的派活线索"
            className="h-20 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-zinc-600 focus:outline-none"
          />
        </Field>
        <Field label="系统提示词" required>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="你是某类安全运维专家..."
            className="h-32 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100 focus:border-zinc-600 focus:outline-none"
          />
        </Field>
        <Field label="允许使用的工具">
          <div className="mb-1 text-[11px] text-zinc-500">留空表示继承 coordinator 的全部工具。</div>
          <div className="max-h-48 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/40 p-2">
            <div className="grid grid-cols-2 gap-1">
              {skills.map((s) => (
                <label key={s.key} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] hover:bg-zinc-900/60">
                  <input type="checkbox" checked={allowedTools.includes(s.key)} onChange={() => toggleTool(s.key)} className="h-3 w-3 accent-indigo-500" />
                  <span className="truncate font-mono">{s.key}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="mt-1 text-[11px] text-zinc-500">已选 {allowedTools.length} / {skills.length}</div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="模型">
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="留空表示继承" className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-zinc-600 focus:outline-none" />
          </Field>
          <Field label="最大轮数">
            <input type="number" value={maxTurns || ''} onChange={(e) => setMaxTurns(parseInt(e.target.value, 10) || 0)} placeholder="留空表示继承" min={0} max={100} className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-zinc-600 focus:outline-none" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function DeleteAgentDialog({ agent, onClose, onDone }: { agent: AgentSummary; onClose: () => void; onDone: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      await deleteAgent(agent.name);
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
      title={`删除 Agent ${agent.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="danger" onClick={() => void submit()} disabled={submitting}>{submitting ? '删除中...' : '删除'}</Button>
        </>
      }
    >
      <div className="text-xs text-zinc-300">
        {err && <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-red-300">{err}</div>}
        <p>确定删除 <span className="font-mono text-zinc-100">{agent.name}</span>？已创建的历史会话不会删除。</p>
      </div>
    </Modal>
  );
}

function SourceLabel({ source }: { source?: AgentSource }) {
  if (source === 'user') return <span className="text-violet-300">自定义</span>;
  if (source === 'builtin') return <span className="text-emerald-300">系统内置</span>;
  if (source === 'disk') return <span>预置文件</span>;
  return <span>预置</span>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
        {label}
        {required && <span className="ml-0.5 text-red-400">*</span>}
      </div>
      {children}
    </label>
  );
}

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
      {children}
    </section>
  );
}

function SmallIcon({ title, danger, onClick, children }: { title: string; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn('rounded p-1 text-zinc-500 hover:bg-zinc-800', danger ? 'hover:text-red-300' : 'hover:text-zinc-200')}
    >
      {children}
    </button>
  );
}

function Tag({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'ok' | 'warn' }) {
  return (
    <span
      className={cn(
        'rounded-md px-1.5 py-0.5 text-[10px] ring-1 ring-inset',
        tone === 'ok'
          ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
          : tone === 'warn'
            ? 'bg-amber-500/10 text-amber-300 ring-amber-500/30'
            : 'bg-zinc-800 text-zinc-300 ring-zinc-700',
      )}
    >
      {children}
    </span>
  );
}

function profileOf(agent: AgentSummary) {
  return AGENT_PROFILE[agent.name] ?? {
    label: agent.name,
    role: agent.description || '自定义 Agent，可按组织场景限制工具、模型和系统提示词。',
    domain: agent.source === 'user' ? '自定义场景' : '扩展 Agent',
    risk: agent.permission_mode === 'read-only' ? '只读' : '按工具风险继承',
  };
}

function builtinRank(name: string): number {
  const idx = BUILTIN_ORDER.indexOf(name);
  return idx === -1 ? BUILTIN_ORDER.length : idx;
}
