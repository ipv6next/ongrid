# Workflows 编排说明

Workflows 是 Ongrid 的可视化编排能力，用来把触发器、Agent、LLM、Skill/Tool、条件判断和通知串成一条可运行的安全运维流程。

## AI 生成是否调用大模型

“AI 生成工作流”会调用当前已配置的 LLM Provider。模型根据用户描述和平台实时工具目录生成 workflow JSON，后端会校验节点和连线后落库。

如果没有配置 LLM Provider，AI 生成不可用，但手动画布编排仍可使用。

## 节点之间怎么连线

画布上的连线表示控制流，不直接传递数据。

操作方式：

1. 把鼠标移动到上游节点右侧的小圆点。
2. 按住并拖到下游节点左侧的小圆点。
3. 松开鼠标后形成连线。
4. 条件节点有 `true` / `false` 两个出口，错误出口是 `error`。

数据引用通过表达式完成，写在下游节点配置里：

```text
{{nodes.<上游节点ID>.output.<字段>}}
```

常见引用：

```text
{{trigger.incident_id}}
{{nodes.load.output.result}}
{{nodes.llm.output.answer}}
{{nodes.llm.output.structured.severity}}
```

## 常用节点类型

`trigger.manual`：手动触发，运行时可输入 JSON 参数。

`trigger.alert_fired`：告警触发，告警产生或重新打开时自动启动匹配工作流。

`trigger.cron`：定时触发，适合周报、月报、定期巡检。

`tool`：调用平台 Skill/Tool，例如 `get_host_load`、`host_bash`、`serve_page`。

`agent`：调用指定 Agent，例如 RCA、SRE、网络、磁盘、容器专家。

`llm`：单次 LLM 调用，适合摘要、分类、生成报告文本或 HTML。

`condition`：条件分支，按表达式走 `true` 或 `false`。

`notify`：发送通知。

`transform` / `set`：整理字段或设置变量。

`http_request`：调用外部 HTTP API。

## HTML 报告输出

如果要生成可查看的网页报告，推荐流程是：

1. `tool` 节点拉取数据。
2. `llm` 节点生成完整 HTML，提示词要求只输出 `<!DOCTYPE html>` 开头的 HTML，不要解释、不要代码围栏。
3. `tool` 节点调用 `serve_page`，参数如下：

```json
{
  "html": "{{nodes.html.output.answer}}",
  "title": "设备分析报告"
}
```

生成后的页面会出现在“报告/产物”的页面产物列表里。

## 客户能否增加节点类型

普通客户不建议直接增加底层节点类型。节点类型是平台能力，需要前后端、执行引擎、审计和权限策略共同支持。

更推荐的扩展方式：

1. 增加 Skill/Tool：把新的运维能力做成工具，然后在工作流里用 `tool` 节点调用。
2. 增加 Agent：把某类专家能力做成 Agent，然后在工作流里用 `agent` 节点调用。
3. 增加内置模板：把成熟流程沉淀成模板，客户从模板创建自己的 workflow。

只有当现有节点模型无法表达业务语义时，才需要开发新的节点类型。
