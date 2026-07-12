import { useEffect, useMemo, useState } from 'react';
import { Database, Plus, RefreshCw, Trash2, Wifi } from 'lucide-react';
import {
  createDataSource,
  deleteDataSource,
  listDataSources,
  testDataSource,
  updateDataSource,
  type DataSource,
  type DataSourceInput,
  type DataSourceType,
} from '@/api/datasources';
import { Card, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';

const TYPES: DataSourceType[] = ['prometheus', 'loki', 'cmdb', 'other'];

const blank: DataSourceInput = {
  name: '',
  type: 'prometheus',
  url: '',
  auth_type: 'none',
  tls_insecure: false,
  enabled: true,
  label_map: '',
};

export default function SettingsDataSources() {
  const [items, setItems] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DataSource | null>(null);
  const [form, setForm] = useState<DataSourceInput>(blank);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await listDataSources();
      setItems(r.items ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const grouped = useMemo(() => {
    return {
      prometheus: items.filter((x) => x.type === 'prometheus'),
      loki: items.filter((x) => x.type === 'loki'),
      other: items.filter((x) => x.type !== 'prometheus' && x.type !== 'loki'),
    };
  }, [items]);

  const startEdit = (ds: DataSource) => {
    setEditing(ds);
    setForm({
      name: ds.name,
      type: ds.type,
      url: ds.url,
      auth_type: ds.auth_type,
      username: ds.username ?? '',
      secret_ref: ds.secret_ref ?? '',
      tls_insecure: ds.tls_insecure,
      enabled: ds.enabled,
      label_map: ds.label_map ?? '',
    });
    setMessage(null);
  };

  const reset = () => {
    setEditing(null);
    setForm(blank);
    setMessage(null);
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (editing) await updateDataSource(editing.id, form);
      else await createDataSource(form);
      reset();
      await reload();
      setMessage('已保存数据源');
    } catch (e) {
      setMessage((e as Error).message || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (ds: DataSource) => {
    if (ds.builtin) return;
    setBusy(true);
    try {
      await deleteDataSource(ds.id);
      await reload();
    } catch (e) {
      setMessage((e as Error).message || '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const probe = async (ds: DataSource) => {
    setBusy(true);
    try {
      const r = await testDataSource(ds.id);
      setMessage(r.ok ? `连接正常，耗时 ${r.latency_ms} ms` : `连接失败：${r.error}`);
    } catch (e) {
      setMessage((e as Error).message || '测试失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">数据源</h2>
            <p className="mt-1 text-xs text-zinc-500">管理内置或客户已有的 Prometheus / Loki，资产可按标签映射到真实监控数据。</p>
          </div>
          <button onClick={() => void reload()} className="inline-flex items-center gap-1 rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900">
            <RefreshCw size={13} />刷新
          </button>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-zinc-500">加载中...</div>
        ) : items.length === 0 ? (
          <EmptyState icon={Database} title="暂无数据源" hint="先添加 Prometheus 或 Loki，再回到资产画像里做关联。" />
        ) : (
          <div className="space-y-4">
            <SourceSection title="Prometheus 指标" items={grouped.prometheus} onEdit={startEdit} onTest={probe} onDelete={remove} />
            <SourceSection title="Loki 日志" items={grouped.loki} onEdit={startEdit} onTest={probe} onDelete={remove} />
            {grouped.other.length > 0 && <SourceSection title="其他来源" items={grouped.other} onEdit={startEdit} onTest={probe} onDelete={remove} />}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100"><Plus size={15} />{editing ? '编辑数据源' : '新增数据源'}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="名称" value={form.name} onChange={(v) => setForm((s) => ({ ...s, name: v }))} placeholder="生产 Prometheus" />
          <label className="block">
            <span className="mb-1 block text-[11px] text-zinc-500">类型</span>
            <select value={form.type} onChange={(e) => setForm((s) => ({ ...s, type: e.target.value as DataSourceType }))} className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <Field label="URL" value={form.url} onChange={(v) => setForm((s) => ({ ...s, url: v }))} placeholder="http://prometheus:9090" />
          <Field label="凭证引用（可选）" value={form.secret_ref ?? ''} onChange={(v) => setForm((s) => ({ ...s, secret_ref: v }))} placeholder="settings/secrets 中的凭证名" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[11px] text-zinc-500">标签映射 JSON（可选）</span>
            <textarea value={form.label_map ?? ''} onChange={(e) => setForm((s) => ({ ...s, label_map: e.target.value }))} placeholder='{"device_id":"instance","business_system":"job"}' rows={3} className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100" />
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={!!form.tls_insecure} onChange={(e) => setForm((s) => ({ ...s, tls_insecure: e.target.checked }))} />
            跳过 TLS 校验
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={form.enabled !== false} onChange={(e) => setForm((s) => ({ ...s, enabled: e.target.checked }))} />
            启用
          </label>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button disabled={busy} onClick={() => void save()} className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 disabled:opacity-50">保存</button>
          {editing && <button onClick={reset} className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300">取消编辑</button>}
          {message && <span className="text-xs text-zinc-400">{message}</span>}
        </div>
      </Card>
    </div>
  );
}

function SourceSection({ title, items, onEdit, onTest, onDelete }: {
  title: string;
  items: DataSource[];
  onEdit(ds: DataSource): void;
  onTest(ds: DataSource): void;
  onDelete(ds: DataSource): void;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold text-zinc-500">{title}</h3>
      <div className="overflow-hidden rounded-lg border border-zinc-800">
        {items.map((ds) => (
          <div key={ds.id} className="flex items-center justify-between gap-3 border-b border-zinc-800/70 px-3 py-2 last:border-b-0">
            <button onClick={() => onEdit(ds)} className="min-w-0 text-left">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm text-zinc-100">{ds.name}</span>
                {ds.builtin && <span className="rounded border border-emerald-500/30 px-1.5 py-0.5 text-[10px] text-emerald-300">内置</span>}
                <span className={cn('rounded px-1.5 py-0.5 text-[10px]', ds.enabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-zinc-800 text-zinc-500')}>{ds.enabled ? '启用' : '停用'}</span>
              </div>
              <div className="mt-0.5 truncate text-xs text-zinc-500">{ds.type} · {ds.url}</div>
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={() => void onTest(ds)} className="rounded-md border border-zinc-800 p-1.5 text-zinc-400 hover:text-zinc-100" title="测试连接"><Wifi size={13} /></button>
              {!ds.builtin && <button onClick={() => void onDelete(ds)} className="rounded-md border border-zinc-800 p-1.5 text-zinc-400 hover:text-red-300" title="删除"><Trash2 size={13} /></button>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange(v: string): void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-zinc-500">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100" />
    </label>
  );
}

