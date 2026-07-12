package flow

import (
	"context"
	"encoding/json"
	"strings"
)

// PlannerDraft is the explainable result of intelligent orchestration. It is
// deliberately separate from a persisted workflow: callers review it before
// passing GraphJSON to Create.
type PlannerDraft struct {
	Name           string
	Description    string
	GraphJSON      string
	Intent         string
	Mode           string // template / planner
	TemplateKey    string
	Steps          []PlannerStep
	RequiredInputs []PlannerInput
	Questions      []PlannerQuestion
	Risks          []PlannerRisk
	Warnings       []string
}

type PlannerStep struct {
	Title       string `json:"title"`
	NodeType    string `json:"node_type"`
	Persona     string `json:"persona,omitempty"`
	Tool        string `json:"tool,omitempty"`
	Description string `json:"description"`
}

type PlannerInput struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Required bool   `json:"required"`
	Reason   string `json:"reason"`
}

type PlannerQuestion struct {
	Key      string `json:"key"`
	Question string `json:"question"`
	Required bool   `json:"required"`
}

type PlannerRisk struct {
	Level   string `json:"level"`
	Message string `json:"message"`
}

// PlannerOptions are explicit operator preferences. They guide a draft but
// never become hard-coded device ids in a reusable workflow graph.
type PlannerOptions struct {
	ReportMode   string // auto / archive / web / none
	AllowChanges bool
}

// PlanWorkflow recognizes high-confidence security operations scenarios and
// emits a deterministic blueprint for them. Other requests still use the
// existing generator, then receive the same explainable metadata.
func (u *Usecase) PlanWorkflow(ctx context.Context, prompt string) (PlannerDraft, error) {
	return u.PlanWorkflowWithOptions(ctx, prompt, PlannerOptions{})
}

func (u *Usecase) PlanWorkflowWithOptions(ctx context.Context, prompt string, options PlannerOptions) (PlannerDraft, error) {
	prompt = strings.TrimSpace(prompt)
	if isContainerIntent(prompt) {
		return withPlannerQuestions(containerInspectionDraft(prompt, normalizedReportMode(prompt, options.ReportMode)), options), nil
	}
	if isAlertIntent(prompt) {
		return withPlannerQuestions(alertInvestigationDraft(normalizedReportMode(prompt, options.ReportMode)), options), nil
	}
	if isPatrolIntent(prompt) {
		return withPlannerQuestions(patrolRiskDraft(normalizedReportMode(prompt, options.ReportMode)), options), nil
	}
	generated, err := u.GenerateGraph(ctx, prompt)
	if err != nil {
		return PlannerDraft{}, err
	}
	g, err := ParseGraph(generated.GraphJSON)
	if err != nil {
		return PlannerDraft{}, err
	}
	draft := makePlannerDraft(generated.Name, generated.Description, generated.GraphJSON, g, "planner", "")
	if options.AllowChanges {
		draft.Warnings = append(draft.Warnings, "已声明允许变更：Planner 仍不会自动执行写操作，需使用 Reviewer/人工确认。")
	}
	return withPlannerQuestions(draft, options), nil
}

func withPlannerQuestions(draft PlannerDraft, options PlannerOptions) PlannerDraft {
	if options.ReportMode == "" || options.ReportMode == "auto" {
		draft.Questions = append(draft.Questions, PlannerQuestion{Key: "report_mode", Question: "请选择报告输出方式，或接受 Planner 的推荐。", Required: false})
	}
	if !options.AllowChanges {
		draft.Questions = append(draft.Questions, PlannerQuestion{Key: "allow_changes", Question: "当前按只读诊断规划；如需提出变更，请开启“允许规划变更建议”。", Required: false})
	}
	for _, input := range draft.RequiredInputs {
		if input.Key == "device_id" {
			draft.Questions = append(draft.Questions, PlannerQuestion{Key: "device_id", Question: "运行时需要选择目标设备；工作流会保留该变量以便重复使用。", Required: true})
			break
		}
	}
	return draft
}

func isContainerIntent(prompt string) bool {
	p := strings.ToLower(prompt)
	return strings.Contains(p, "docker") || strings.Contains(p, "container") || strings.Contains(prompt, "容器")
}

func isAlertIntent(prompt string) bool {
	p := strings.ToLower(prompt)
	return strings.Contains(prompt, "告警") || strings.Contains(prompt, "事件") || strings.Contains(p, "incident") || strings.Contains(p, "alert")
}

func isPatrolIntent(prompt string) bool {
	p := strings.ToLower(prompt)
	return strings.Contains(prompt, "巡检") || strings.Contains(p, "patrol") || strings.Contains(prompt, "基线")
}

func normalizedReportMode(prompt, requested string) string {
	switch requested {
	case "archive", "web", "none":
		return requested
	}
	lower := strings.ToLower(prompt)
	if strings.Contains(prompt, "网页") || strings.Contains(prompt, "HTML") || strings.Contains(lower, "web") || strings.Contains(lower, "html") {
		return "web"
	}
	if strings.Contains(prompt, "报告") || strings.Contains(prompt, "RCA") || strings.Contains(lower, "report") {
		return "archive"
	}
	return "none"
}

func containerInspectionDraft(prompt, reportMode string) PlannerDraft {
	nodes := []GraphNode{
		{ID: "trigger", Type: NodeTriggerManual, Name: "选择目标设备", Config: json.RawMessage(`{}`), Position: &Position{X: 80, Y: 160}},
		{ID: "container", Type: NodeAgent, Name: "容器运维专家", Config: json.RawMessage(`{"persona":"specialist-container","instruction":"检查设备 {{trigger.device_id}} 的 Docker 容器状态。先查询知识库，再执行 docker version、docker ps -a、docker stats --no-stream 等只读检查；输出异常容器、健康状态、退出码、重启次数、证据和建议。禁止执行任何修改操作。"}`), Position: &Position{X: 350, Y: 160}},
	}
	edges := []GraphEdge{{ID: "trigger-container", Source: "trigger", Target: "container", SourcePort: PortNext}}
	nodes, edges = appendReportPresentation(nodes, edges, "container", reportMode, "Docker 容器巡检报告")
	g := &Graph{Nodes: nodes, Edges: edges}
	raw, _ := json.Marshal(g)
	draft := makePlannerDraft("Docker 容器巡检", "[类型:报告] [报告:"+reportMode+"] 使用容器运维专家对目标设备执行 Docker 只读诊断。", string(raw), g, "template", "docker-container-inspection")
	draft.Intent = "Docker 容器只读巡检"
	draft.Risks = append(draft.Risks, PlannerRisk{Level: "policy", Message: "目标 Edge 必须启用“Docker 只读巡检”安全策略；本流程不包含启动、停止、删除或更新容器操作。"})
	return draft
}

func alertInvestigationDraft(reportMode string) PlannerDraft {
	nodes := []GraphNode{
		{ID: "alert", Type: NodeTriggerAlert, Name: "告警触发", Config: json.RawMessage(`{}`), Position: &Position{X: 80, Y: 100}},
		{ID: "manual", Type: NodeTriggerManual, Name: "手动复查", Config: json.RawMessage(`{}`), Position: &Position{X: 80, Y: 240}},
		{ID: "investigate", Type: NodeAgent, Name: "RCA 调查专家", Config: json.RawMessage(`{"persona":"incident-investigator","instruction":"调查事件 {{trigger.incident_id}}。关联指标、日志、链路和 Edge 上下文，输出根因判断、证据、影响范围和建议动作；高风险动作只提出建议，不自动执行。"}`), Position: &Position{X: 360, Y: 165}},
	}
	edges := []GraphEdge{{ID: "alert-investigate", Source: "alert", Target: "investigate", SourcePort: PortNext}, {ID: "manual-investigate", Source: "manual", Target: "investigate", SourcePort: PortNext}}
	nodes, edges = appendReportPresentation(nodes, edges, "investigate", reportMode, "告警 RCA 报告")
	g := &Graph{Nodes: nodes, Edges: edges}
	raw, _ := json.Marshal(g)
	draft := makePlannerDraft("告警自动调查", "[类型:告警] [报告:"+reportMode+"] 自动调查告警事件并回填 RCA 证据。", string(raw), g, "template", "alert-auto-investigation")
	draft.Intent = "告警自动调查和 RCA 证据回填"
	return draft
}

func patrolRiskDraft(reportMode string) PlannerDraft {
	nodes := []GraphNode{
		{ID: "trigger", Type: NodeTriggerManual, Name: "选择巡检设备", Config: json.RawMessage(`{}`), Position: &Position{X: 80, Y: 160}},
		{ID: "load", Type: NodeTool, Name: "拉取设备资源快照", Config: json.RawMessage(`{"tool":"get_host_load","args":{"device_ids":["{{trigger.device_id}}"]}}`), Position: &Position{X: 330, Y: 160}},
		{ID: "review", Type: NodeAgent, Name: "巡检风险分析", Config: json.RawMessage(`{"persona":"specialist-ops","instruction":"根据设备 {{trigger.device_id}} 的资源快照分析巡检风险：{{nodes.load.output.result}}。输出风险等级、证据、影响和只读复查建议。"}`), Position: &Position{X: 590, Y: 160}},
	}
	edges := []GraphEdge{{ID: "trigger-load", Source: "trigger", Target: "load", SourcePort: PortNext}, {ID: "load-review", Source: "load", Target: "review", SourcePort: PortNext}}
	nodes, edges = appendReportPresentation(nodes, edges, "review", reportMode, "安全巡检风险报告")
	g := &Graph{Nodes: nodes, Edges: edges}
	raw, _ := json.Marshal(g)
	draft := makePlannerDraft("巡检风险报告", "[类型:巡检] [报告:"+reportMode+"] 汇总设备巡检风险并生成处置建议。", string(raw), g, "template", "patrol-risk-report")
	draft.Intent = "安全巡检风险分析"
	return draft
}

func appendReportPresentation(nodes []GraphNode, edges []GraphEdge, sourceID, mode, title string) ([]GraphNode, []GraphEdge) {
	if mode == "none" {
		return nodes, edges
	}
	if mode == "archive" {
		nodes = append(nodes, GraphNode{ID: "report", Type: NodeLLM, Name: "整理归档报告", Config: json.RawMessage(`{"system":"你是安全运维报告助手。只依据上游事实输出中文报告，不编造数据。","prompt":"整理以下诊断结果，输出摘要、证据、影响、建议和复查项：{{nodes.` + sourceID + `.output.answer}}"}`), Position: &Position{X: 860, Y: 160}})
		return nodes, append(edges, GraphEdge{ID: sourceID + "-report", Source: sourceID, Target: "report", SourcePort: PortNext})
	}
	nodes = append(nodes,
		GraphNode{ID: "html", Type: NodeLLM, Name: "生成 Web 报告", Config: json.RawMessage(`{"system":"你是网页报告生成器。只输出完整 HTML（<!DOCTYPE html> 开头），不要解释或代码围栏。","prompt":"根据以下安全运维诊断结果生成可阅读的中文 Web 报告：{{nodes.` + sourceID + `.output.answer}}"}`), Position: &Position{X: 860, Y: 160}},
		GraphNode{ID: "page", Type: NodeTool, Name: "发布 Web 报告", Config: json.RawMessage(`{"tool":"serve_page","args":{"html":"{{nodes.html.output.answer}}","title":"` + title + `"}}`), Position: &Position{X: 1110, Y: 160}},
	)
	edges = append(edges, GraphEdge{ID: sourceID + "-html", Source: sourceID, Target: "html", SourcePort: PortNext}, GraphEdge{ID: "html-page", Source: "html", Target: "page", SourcePort: PortNext})
	return nodes, edges
}

func makePlannerDraft(name, description, graphJSON string, g *Graph, mode, templateKey string) PlannerDraft {
	d := PlannerDraft{Name: name, Description: description, GraphJSON: graphJSON, Intent: "个性化安全运维编排", Mode: mode, TemplateKey: templateKey}
	seenInputs := map[string]bool{}
	for _, n := range g.Nodes {
		step := PlannerStep{Title: n.Name, NodeType: n.Type, Description: nodePlannerDescription(n.Type)}
		var cfg map[string]any
		_ = json.Unmarshal(n.Config, &cfg)
		if n.Type == NodeAgent {
			step.Persona, _ = cfg["persona"].(string)
		}
		if n.Type == NodeTool {
			step.Tool, _ = cfg["tool"].(string)
		}
		d.Steps = append(d.Steps, step)
		for _, match := range triggerFieldRef.FindAllStringSubmatch(string(n.Config), -1) {
			key := match[1]
			if !seenInputs[key] {
				seenInputs[key] = true
				d.RequiredInputs = append(d.RequiredInputs, PlannerInput{Key: key, Label: plannerInputLabel(key), Required: true, Reason: "供工作流节点在运行时引用"})
			}
		}
	}
	return d
}

func nodePlannerDescription(typ string) string {
	switch typ {
	case NodeTriggerManual:
		return "由操作人员选择目标和参数后启动"
	case NodeTriggerAlert:
		return "由告警事件自动启动"
	case NodeAgent:
		return "由指定专家自主调用允许的工具完成诊断"
	case NodeLLM:
		return "整理已有事实，不直接执行主机命令"
	case NodeTool:
		return "调用一个受治理的原子工具"
	default:
		return "工作流控制或数据处理步骤"
	}
}

func plannerInputLabel(key string) string {
	switch key {
	case "device_id":
		return "目标设备"
	case "incident_id":
		return "关联事件"
	default:
		return key
	}
}
