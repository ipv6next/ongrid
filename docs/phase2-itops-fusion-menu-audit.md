# Phase 2 ITOps 融合菜单审计

## 结论

Phase 2 不应该把 ITOps 演示站的菜单整套搬进 Ongrid。演示站内容多而全，适合展示“传统 ITOps 平台覆盖面”，但我们的产品主线是 Ongrid：Edge、WebShell、Agent、Skill、RCA、Evidence、Audit、Report。

融合策略是：保留 Ongrid 已经跑通的核心能力，把 ITOps 在政企安全运维里的页面经验、字段、流程和治理要求吸收到 Ongrid 原生页面中。只有当 Ongrid 没有承载位置、且该能力确实是安全运维闭环所必需时，才新增页面。

## 取舍原则

1. Ongrid 已有能力优先复用，不复制第二套资产、终端、Agent、知识库、工作流。
2. ITOps 的传统运维资产管理能力只吸收元数据和视图，不回到直接 SSH 凭证托管为中心的模式。
3. 高风险操作必须进入 Ongrid 的审批、审计和建议动作链路，先做人工确认，不做默认自动执行。
4. 报告、复盘、巡检、告警降噪、处置策略是 Phase 2 高价值区域。
5. 演示型页面、模拟型大屏、未打通数据的装饰页面不进入主导航。

## 推荐信息架构

主流程保留简洁中文导航：

| 一级入口 | 定位 | Ongrid 主体 |
|---|---|---|
| AI 助手 | 对话、工具调用、诊断入口 | Chat / Agent / Skill |
| 仪表盘 | 产品态势、事件和资产健康 | Dashboard / Metrics |
| 事件 | 告警、Incident、RCA、处置闭环 | Alert / Incident / Investigation |
| 资产 | Edge、主机、业务元数据、分组 | Device / Edge / Topology |
| WebShell | 浏览器终端、会话审计 | Edge Tunnel / WebShell |
| 审计 | 人、AI、工具、终端、配置变更审计 | Audit Log |
| 报告 | 巡检报告、RCA 报告、周/月报 | Reports |
| 设置 | LLM、集成、用户、策略 | Settings |

Ongrid 原生能力不能隐藏，应作为二级能力保留：技能 / 工具、Agent、工作流、知识库、MCP、拓扑、指标、日志。它们是产品底座，不是 ITOps 的替代项。

## ITOps 演示站菜单取舍矩阵

| ITOps 菜单 | 解决的问题 | 与 Ongrid 的关系 | 冲突点 | 融合方式 | 优先级 |
|---|---|---|---|---|---|
| 仪表板 | 总览运维状态 | Ongrid Dashboard 已有承载 | ITOps 更偏传统资源大盘 | 吸收安全态势卡片：待处置事件、巡检风险、Edge 异常、LLM 可用性 | P1 |
| 监控大屏 | NOC 展示 | Ongrid Metrics/Grafana 已有 | 容易变成演示装饰 | 后置，作为 Dashboard 的只读展示模式或 Grafana 链接 | P3 |
| 数据机房 | 机房/DCIM 视角 | Ongrid 当前不是 DCIM 平台 | 偏离 AI-SecOps 主线 | 只吸收资产字段：区域、机房、云厂商、负责人 | P1 |
| 服务器管理 | 主机资产、命令入口 | 对应 Ongrid Assets/Edge | ITOps 以 SSH 凭证为中心，和零入站 Edge 思路冲突 | 吸收分组、标签、业务系统、负责人、等保级别；命令入口仍走 Edge/WebShell | P1 |
| 虚拟机/容器/镜像/卷/网络管理 | 云资源/容器资源管理 | Ongrid 可观测与拓扑可关联 | 变成云管平台会失焦 | 暂不做独立管理页，后续作为资产类型扩展 | P4 |
| 网络设备/SNMP/发现 | 网络资产发现 | 与 Topology/Assets 有交集 | 当前 Edge 主线不覆盖 SNMP 管理 | 先吸收“网络巡检模板”和资产字段，发现能力后置 | P3 |
| 数据库管理 | DB 连接与巡检 | Ongrid 有 DB 诊断知识/Skill 可承载 | 不宜做通用 DB 管控平台 | 做 DB 巡检 Skill/模板，不做独立数据库管理 MVP | P3 |
| 认证凭证 | SSH key/密码管理 | 与 WebShell/Edge 安全模型强相关 | 直接托管 SSH 凭证会削弱零入站叙事 | 只做 Edge 安装令牌、API Key、LLM Key、审计密钥治理 | P2 |
| Web 终端 | 远程命令执行 | Ongrid WebShell 已跑通 | 不应复制传统 SSH 终端 | 吸收会话列表、风险提示、命令历史、复制审计上下文 | P1 |
| 远程桌面 | Windows/RDP 运维 | Ongrid 当前主线不覆盖 | 高复杂度、高风险 | 后置为扩展，不进 Phase 2 主线 | P4 |
| Agent 管理 | Agent 状态与任务 | Ongrid Agent/Edge 已有 | 名称易混淆：LLM Agent vs 主机 Agent | 保留 Ongrid Agent 页面，文案区分“智能体”和“边缘节点” | P1 |
| 工作流 | 编排自动化 | Ongrid Workflows 已有 | 重复工作流平台 | 保留 Ongrid 工作流，吸收 ITOps 任务状态/审批提示 | P2 |
| 任务执行 | 作业历史 | 对应 Skill/Workflow/Audit | 如果独立会切碎审计 | 融入审计页和工作流详情，提供任务维度过滤 | P2 |
| 审批中心 | 高风险操作审批 | Ongrid Suggested Action 需要它 | 无冲突，是政企增强点 | 建为“人工确认/审批”子流程，连接 Ack、Assign、Resolve、RCA、Suggested Action | P1 |
| 脚本中心 | 运维脚本模板 | 对应 Ongrid Skill/Tool | 任意脚本执行风险高 | 迁移为“Skill 模板/巡检模板”，标注只读/变更/高危 | P2 |
| 定时任务 | 周期巡检/报表 | 对应 Workflow/Scheduler | 独立调度会重复 | 接 Ongrid 工作流或轻量调度，用于巡检和周/月报 | P2 |
| 告警中心 | 告警列表 | Ongrid Incidents 已有 | 重复列表 | 合并为事件入口，增强筛选、分派、SLA、处置状态 | P1 |
| 告警自动处理 | 告警触发工作流 | Ongrid 自动调查已跑通 | 自动修复过早会有风险 | 先做“自动调查策略”和“建议动作生成”，修复需人工确认 | P1 |
| 告警降噪 | 重复/风暴抑制 | Ongrid Incident dedupe 可增强 | 演示站偏统计展示 | 做事件页子能力：相似告警合并、抑制记录、降噪原因 | P2 |
| 告警关联 | 多告警关联成事件 | 与 RCA 证据链高度相关 | 无明显冲突 | 作为 RCA evidence/correlation 的可视化增强 | P2 |
| 根因分析 | RCA 历史和状态 | Ongrid RCA 已跑通 | ITOps 页面多为模拟列表 | 吸收 RCA 历史、置信度、证据摘要、复盘入口 | P1 |
| AI 根因报告 | LLM 报告 | Ongrid Investigation Report 已有 | 不应另起 AI 报告体系 | 合入事件详情和报告页，支持复制/导出/归档 | P1 |
| 服务拓扑 | 爆炸半径 | Ongrid Topology 已有 | 无冲突 | 在 Incident/RCA 中嵌入影响范围和拓扑跳转 | P2 |
| AI 洞察 | AI 运营摘要 | 对应 AI 助手/Dashboard | 容易空泛 | 只保留可操作洞察：风险、建议动作、待确认事项 | P3 |
| AI 自动分析 | 告警自动调查 | Ongrid 核心能力 | 无冲突 | 保留 Ongrid investigator，增强策略配置和审计可见性 | P1 |
| 巡检中心 | 安全/健康巡检 | Phase 1 已做 MVP | ITOps 脚本不能直接照搬 | 扩展为巡检模板、历史记录、报告生成 | P1 |
| 自动修复策略 | 修复规则 | 对应 Suggested Action/Approval | 自动执行风险高 | 先做策略草案和人工确认，记录审计和回滚建议 | P2 |
| 修复效果仪表板 | 修复效果统计 | Reports/Dashboard 可承载 | 早期数据不足 | 后置，先在报告中统计闭环效果 | P3 |
| 修复执行记录 | 修复审计 | Audit/Incident 可承载 | 独立页会割裂上下文 | 融入审计页，增加 action/resource/result 过滤 | P2 |
| 自愈工作台 | 待审批/执行台 | 与人工确认高度相关 | 名称容易暗示自动变更 | 命名为“处置确认”或“人工确认”，放事件流程中 | P1 |
| AI 修复记录 | AI 建议动作历史 | Ongrid Tool/Audit/Report 可承载 | 不应独立成孤岛 | 作为审计过滤和事件详情时间线 | P2 |
| 知识库 | 经验沉淀 | Ongrid Knowledge 已有 | 无冲突 | 吸收复盘入库、相似事件推荐、人工确认 | P2 |
| 审计日志 | 操作追踪 | Ongrid Audit 已有 | 当前需要继续增强上下文 | 增加 WebShell、AI tool、RCA、配置变更、处置闭环过滤 | P1 |
| 通知系统 | 消息触达 | Ongrid IM/Integrations 可承载 | 多通道接入可能分散 | 放 Settings/Integrations，事件策略引用 | P3 |
| 报告系统 | 模板、已生成、定时、分析 | Ongrid Reports 需要增强 | 演示站模板多但数据模拟 | 建立巡检报告、RCA 报告、周/月报告模板，接真实数据 | P1 |
| 用户管理 | 用户/角色 | Ongrid Settings 已有 | 无冲突 | 保留 Ongrid 用户体系，吸收审计和角色文案 | P2 |
| 前端测试中心 | 演示/测试 | 产品无直接价值 | 不进入客户产品 | 仅开发环境内部保留，不进导航 | 不做 |
| 设置 | 系统配置 | Ongrid Settings 已有 | 无冲突 | 保留 Ongrid 设置，强化 LLM、通知、审计保留、策略配置 | P1 |

## Phase 2 首批实施建议

### 第一批：不新增大页面，增强现有主流程

1. 事件页：把告警、自动调查、RCA、建议动作、人工确认、复盘报告串成一条时间线。
2. 资产页：完善业务系统、区域/机房/云厂商、负责人、等保级别、重要性、运维窗口、标签。
3. WebShell：增加会话列表、命令风险标记、从审计跳回会话上下文。
4. 审计页：补齐 AI 工具调用、WebShell、告警处置、配置变更、报告导出过滤。
5. 报告页：做巡检报告、RCA 报告、周/月报告三个模板，支持复制、下载、从事件/巡检生成。
6. 技能页：吸收 SkillOps 思路，给技能加风险等级、只读/变更、审批要求、测试状态。

### 第二批：增加政企安全运维子能力

1. 巡检模板：把 ITOps 脚本经验迁移为 Ongrid Skill/Tool 模板。
2. 告警降噪：相似告警合并、重复抑制、抑制原因和恢复操作。
3. 人工确认：对高风险建议动作建立待确认队列。
4. 复盘中心：从 Incident/RCA 归档生成，不作为孤立内容库。

### 暂缓能力

1. 远程桌面。
2. 云管/虚拟机/容器全生命周期管理。
3. DCIM/机房大屏。
4. 自动修复默认执行。
5. 传统脚本中心和直接 SSH 凭证管理。

## 与演示站对照后的判断

演示站的价值在“产品覆盖面”和“菜单命名提示”，不是在工程实现深度。抽样看到多个页面是模拟数据或加载态，说明它适合做素材库，不适合作为产品主架构。

我们的阶段目标应更克制：用 Ongrid 真链路承载少量高价值闭环。每个新增功能都必须回答三个问题：

1. 是否能连接真实 Edge / Incident / RCA / Audit / Report 数据？
2. 是否增强安全运维闭环，而不是扩展成传统运维平台？
3. 是否能复用 Ongrid 已有 Agent / Skill / Workflow / Knowledge 能力？

如果三个问题不能同时回答清楚，就先不进入 Phase 2 主线。
