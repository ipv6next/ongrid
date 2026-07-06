# AI-SecOps Productization Plan

本分支用于把产品版主线切换到 Ongrid：Ongrid 作为核心智能运维底座，ITOps 作为产品化经验和能力素材库，不再继续在 ITOps/JS Runtime 中重复实现 Ongrid 已具备的核心能力。

## 方向结论

产品版采用：

```text
Ongrid Core
  Manager / Edge / Agent / RCA / Tool / Observability / WebShell / Knowledge

AI-SecOps Product Layer
  中文化、政企安全策略、审批治理、资产视角、报告复盘、网络运行安全 Skill Pack

ITOps Reference
  保留申报版与产品素材，吸收其管控台、审批、知识库、报表、资产管理、配置体验
```

不再把 ITOps 作为产品主架构，也不再把 ai-secops-agent-runtime 作为长期核心 Agent Runtime。它们保留为申报版原型、功能验证记录和可迁移素材。

## 为什么转向 Ongrid 主线

Ongrid 已经覆盖产品内核中最难、最安全敏感的部分：

- Coordinator + Specialist Agent
- 告警触发 RCA investigator
- Investigation report 与 evidence 回填
- Edge 主动外联，零入站端口
- 浏览器 WebShell / SSH 审计通道
- Prometheus / Loki / Tempo / Grafana 可观测栈
- Skills / Agents / Knowledge / Tools
- IM 通道、模型路由、审计、审批雏形

继续在 ITOps 后端和 JS Runtime 中复刻这些能力，会造成长期重复造轮子，且稳定性、安全性、协议一致性都难以追上 Ongrid 主线。

## ITOps 能力吸收清单

优先吸收的是产品化能力，不是传统工作流内核：

| ITOps 能力 | 迁移策略 |
|---|---|
| 中文化后台体验 | 融入 Ongrid 前端 i18n 与菜单命名 |
| LLM 配置体验 | 对齐 Ongrid Settings / LLM，增强 OpenAI-compatible 国内模型 |
| 审批治理 | 强化 Ongrid Approvals，面向高危命令、修复建议、变更验证 |
| 知识库 / RAG 体验 | 对齐 Ongrid Knowledge，增加复盘入库、防重复、人工确认 |
| 报告系统 | 强化 Incident / Investigation / Report 导出 |
| 资产/服务器管理 | 对齐 Ongrid Devices / Topology，补政企资产字段 |
| 告警降噪 | 结合 Ongrid Incident dedupe/inhibit 与 ITOps 降噪思路 |
| 安全策略配置 | 补命令策略、工具权限、Skill 风险等级、角色策略 |
| 大屏展示 | 后续基于 Ongrid Dashboard / Monitor / Alerts 做 NOC 视图 |

后置或暂不迁移：

- VM / K8s / Docker 全生命周期管理
- DCIM / 机房 3D / PDU / UPS
- 自动伸缩和高危自动变更
- 大而全的拖拽工作流平台

这些能力可以作为扩展模块，但不能抢占 AI-SecOps 主线。

## 核心链路跑通目标

第一阶段先跑通 Ongrid 原生链路，不做大改：

1. Manager 启动并能登录。
2. 前端页面可访问，中文/英文切换可用。
3. LLM 配置可用，支持 OpenAI-compatible 模型。
4. Device / Edge 注册可用，Edge 主动外联。
5. WebShell 可通过 Edge 打开，命令审计可见。
6. Prometheus 指标进入 Manager，Monitor 页面可查。
7. Loki 日志进入 Manager，Logs 页面可查。
8. Alert / Incident 创建后自动触发 investigation。
9. Incident Detail 可看到 root cause、tool calls、evidence、report。
10. Knowledge / Skill / Agent 页面能展示并参与诊断。

## 本地运行注意

当前 Windows 本机没有 Go 和可用 Docker Engine 时，不能完整跑 Manager/Edge。可先做前端构建和代码走查：

```powershell
cd D:\ITOps-ongrid\ongrid\web
npm ci
npm run build
```

完整链路建议用 Docker Desktop 或 Linux/VPS 环境。

### 推荐端口避让

Ongrid dev compose 默认会占用：

| 组件 | 默认端口 |
|---|---|
| nginx https | 443 |
| nginx http redirect | 80 |
| Grafana | 3000 |
| Prometheus | 9090 |
| Manager metrics | 9100 |
| Frontier edge tunnel | 40012 |
| MySQL | 3306 |

如果本机还在跑 ITOps 前端 `3000`，建议启动 Ongrid 前在 `.env` 中调整：

```env
ONGRID_HTTP_PORT=8443
ONGRID_HTTP_REDIRECT_PORT=8088
GRAFANA_PORT=3002
ONGRID_ADMIN_EMAIL=admin@ongrid.local
ONGRID_ADMIN_PASSWORD=<strong-password>
ONGRID_JWT_SECRET=<long-random-string>
ONGRID_SECRET_KEY=<32+-random-string>
```

然后：

```powershell
cd D:\ITOps-ongrid\ongrid
Copy-Item .env.example .env
# 编辑 .env 后
make compose-up
```

Windows 若无 `make`，可直接：

```powershell
docker compose -f deploy\docker-compose.yml up -d
```

## 与旧工程关系

```text
D:\ITOps-ongrid\ongrid
  产品版主线。当前分支：ai-secops-product

D:\ITOps-ongrid\itops
  申报版原型和产品素材库。保留，不继续承载核心内核。

D:\ITOps-ongrid\ai-secops-agent-runtime
  原型 Runtime。冻结深挖，后续只作为迁移参考。
```

## 下一批开发建议

Batch 1：Ongrid 核心链路验证。

- 启动 Manager + Web + Prometheus + Loki + Tempo + Grafana。
- 创建管理员并登录。
- 配置 OpenAI-compatible LLM。
- 注册一个 Edge。
- 验证 WebShell。
- 制造一个告警，确认 investigation report 生成。
- 记录每一步的 API、页面、日志和阻塞点。

理由：先确认 Ongrid 原生能力真实可用，再决定哪里吸收 ITOps。否则会再次陷入边理解边重写。

Batch 2：AI-SecOps 产品外观与中文化。

- 收敛菜单为政企安全运维语义。
- 保留 Ongrid 信息架构，但优化中文命名。
- 梳理首页、Devices、Alerts、Incident、Skills、Knowledge、Settings 的第一轮文案。

理由：核心链路跑通后，产品外观和表达马上决定客户感知。

Batch 3：吸收 ITOps 高价值能力。

- 审批治理增强。
- 安全策略配置。
- 复盘入库与防重复。
- 报告/审计包导出。
- 资产字段与网络运行安全 Skill Pack。

理由：这是我们区别于原版 Ongrid 的行业化产品价值。
