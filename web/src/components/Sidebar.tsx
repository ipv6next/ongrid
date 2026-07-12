import { useEffect } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Bot,
  Brain,
  CheckSquare,
  ClipboardList,
  Database,
  FileText,
  GitBranch,
  HardDrive,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ScrollText,
  Settings,
  ShieldCheck,
  ShieldAlert,
  TerminalSquare,
  Wrench,
  Workflow,
} from 'lucide-react';
import { Avatar } from './Avatar';
import { OngridLogo } from './OngridLogo';
import { cn } from '@/lib/cn';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';
import { useIncidentBadge } from '@/store/incidentBadge';
import { useChatSessions } from '@/store/chatSessions';

const PRODUCT_PRIMARY_NAV = [
  { to: '/assistant', label: 'AI 助手', icon: MessageSquare, badge: false },
] as const;

const PRODUCT_WORKBENCH_NAV = [
  { to: '/dashboard', label: '运营总览', icon: LayoutDashboard, badge: false },
  { to: '/alerts', label: '事件中心', icon: ShieldAlert, badge: true },
  { to: '/approvals', label: '人工确认', icon: CheckSquare, badge: false },
  { to: '/reports', label: '报告中心', icon: FileText, badge: false },
] as const;

const PRODUCT_ASSET_NAV = [
  { to: '/devices', label: '资产管理', icon: HardDrive },
  { to: '/edges/shell-sessions', label: 'WebShell', icon: TerminalSquare },
  { to: '/topology', label: '网络拓扑', icon: Network },
  { to: '/monitor', label: '指标查询', icon: Activity },
  { to: '/logs', label: '日志查询', icon: ScrollText },
  { to: '/settings/datasources', label: '数据源', icon: Database },
] as const;

const PRODUCT_INTELLIGENCE_NAV = [
  { to: '/agents', label: 'AI 专家', icon: Bot },
  { to: '/skills', label: '技能工具', icon: Wrench },
  { to: '/workflows', label: '自动化流程', icon: Workflow },
  { to: '/tasks', label: '任务调度', icon: Activity },
  { to: '/knowledge', label: '知识库', icon: Brain },
  { to: '/mcp', label: 'AI 连接器', icon: GitBranch },
] as const;

const PRODUCT_GOVERNANCE_NAV = [
  { to: '/patrol', label: '安全巡检', icon: ClipboardList },
  { to: '/alerts/rules', label: '告警规则', icon: ShieldAlert },
  { to: '/edge-security', label: 'Edge 安全策略', icon: ShieldCheck },
  { to: '/admin/audit', label: '审计日志', icon: ScrollText },
] as const;

const PRODUCT_SYSTEM_NAV = [
  { to: '/settings/health', label: '系统设置', icon: Settings },
] as const;

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUi();
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const { email, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const refreshSessions = useChatSessions((s) => s.refresh);
  const incidentOpen = useIncidentBadge((s) => s.openCount);

  useEffect(() => {
    void refreshSessions();
  }, [location.pathname, refreshSessions]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (sidebarCollapsed) {
    return (
      <aside className="flex h-full w-14 shrink-0 flex-col items-center gap-2 border-r border-zinc-800/60 bg-zinc-900 py-3">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="展开侧栏"
          title="展开侧栏"
          className="rounded-lg p-1 hover:bg-zinc-800/60"
        >
          <OngridLogo size={34} />
        </button>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="展开侧栏"
          className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <PanelLeftOpen size={16} />
        </button>
        <nav className="mt-2 flex flex-1 flex-col items-center gap-1 overflow-y-auto">
          {[...PRODUCT_PRIMARY_NAV, ...PRODUCT_WORKBENCH_NAV, ...PRODUCT_ASSET_NAV, ...PRODUCT_INTELLIGENCE_NAV, ...PRODUCT_GOVERNANCE_NAV, ...PRODUCT_SYSTEM_NAV].map((item) => (
            <CollapsedNavItem
              key={item.to}
              to={item.to}
              label={item.label}
              icon={item.icon}
              badge={'badge' in item && item.badge ? incidentOpen : 0}
            />
          ))}
        </nav>
        <button
          type="button"
          onClick={handleLogout}
          aria-label="退出登录"
          className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-red-300"
        >
          <LogOut size={16} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-zinc-800/60 bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-3">
        <Link to="/dashboard" className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 hover:bg-zinc-800/40">
          <OngridLogo size={32} />
          <span className="truncate text-[16px] font-semibold text-zinc-100">AI-SecOps</span>
        </Link>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="收起侧栏"
          className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      <div className="border-b border-zinc-800/60 px-3 py-3">
        <div className="flex min-w-0 items-center gap-2 rounded-lg bg-zinc-950/35 px-2 py-2">
          <Avatar email={email} size={28} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-zinc-100">{email || '用户'}</div>
            <div className="text-[11px] text-zinc-500">安全运维工作台</div>
          </div>
        </div>
      </div>

      <div className="px-3 py-2">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label="打开命令面板"
          className="flex w-full items-center gap-2 rounded-md border border-zinc-800/60 bg-zinc-950/40 px-2.5 py-1.5 text-left text-[12px] text-zinc-500 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-300"
        >
          <Search size={13} className="text-zinc-500" />
          <span className="flex-1 truncate">搜索路由 / 会话</span>
          <kbd className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-500">Ctrl K</kbd>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <NavGroup items={PRODUCT_PRIMARY_NAV} badge={incidentOpen} />
        <NavGroup title="运营工作台" items={PRODUCT_WORKBENCH_NAV} badge={incidentOpen} />
        <NavGroup title="资产与观测" items={PRODUCT_ASSET_NAV} />
        <NavGroup title="智能编排" items={PRODUCT_INTELLIGENCE_NAV} />
        <NavGroup title="安全治理" items={PRODUCT_GOVERNANCE_NAV} />
        <NavGroup title="系统管理" items={PRODUCT_SYSTEM_NAV} />
      </nav>

      <div className="border-t border-zinc-800/60 p-2">
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-red-300"
        >
          <LogOut size={15} />
          退出登录
        </button>
      </div>
    </aside>
  );
}

function NavGroup({
  title,
  items,
  badge = 0,
}: {
  title?: string;
  items: readonly NavItem[];
  badge?: number;
}) {
  return (
    <div className={title ? 'mt-5' : ''}>
      {title && (
        <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
          {title}
        </div>
      )}
      <div className="space-y-1">
        {items.map((item) => (
          <SidebarNavItem
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={item.label}
            badge={'badge' in item && item.badge ? badge : 0}
          />
        ))}
      </div>
    </div>
  );
}

type NavItem =
  | (typeof PRODUCT_PRIMARY_NAV)[number]
  | (typeof PRODUCT_WORKBENCH_NAV)[number]
  | (typeof PRODUCT_ASSET_NAV)[number]
  | (typeof PRODUCT_INTELLIGENCE_NAV)[number]
  | (typeof PRODUCT_GOVERNANCE_NAV)[number]
  | (typeof PRODUCT_SYSTEM_NAV)[number];

type ChatSessionLike = {
  id: string;
  title?: string;
  agent_id?: string | null;
};

function SessionGroup({ sessions }: { sessions: ChatSessionLike[] }) {
  return (
    <div className="mt-5">
      <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
        AI 助手会话</div>
      <div className="space-y-1">
        {sessions.length === 0 ? (
          <div className="px-3 py-1.5 text-[12px] text-zinc-600">暂无会话</div>
        ) : (
          sessions.map((session, index) => (
            <NavLink
              key={session.id}
              to={`/chat/${session.id}`}
              title={session.title || `会话 ${index + 1}`}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-colors',
                  isActive
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100',
                )
              }
            >
              <MessageSquare size={14} className="shrink-0 text-zinc-500" />
              <span className="min-w-0 flex-1 truncate">{session.title || `会话 ${index + 1}`}</span>
              {session.agent_id && session.agent_id !== 'default' && (
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                  {session.agent_id}
                </span>
              )}
            </NavLink>
          ))
        )}
      </div>
    </div>
  );
}

function SidebarNavItem({
  to,
  icon: Icon,
  label,
  badge = 0,
}: {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-indigo-500/15 text-indigo-200'
            : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100',
        )
      }
    >
      <Icon size={16} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge > 0 && (
        <span className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {badge}
        </span>
      )}
    </NavLink>
  );
}

function CollapsedNavItem({
  to,
  icon: Icon,
  label,
  badge = 0,
}: {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        cn(
          'relative rounded-lg p-2 transition-colors',
          isActive
            ? 'bg-indigo-500/15 text-indigo-200'
            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
        )
      }
    >
      <Icon size={16} />
      {badge > 0 && (
        <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-zinc-950" />
      )}
    </NavLink>
  );
}
