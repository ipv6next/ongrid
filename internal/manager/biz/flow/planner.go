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

type PlannerRisk struct {
	Level   string `json:"level"`
	Message string `json:"message"`
}

// PlanWorkflow recognizes high-confidence security operations scenarios and
// emits a deterministic blueprint for them. Other requests still use the
// existing generator, then receive the same explainable metadata.
func (u *Usecase) PlanWorkflow(ctx context.Context, prompt string) (PlannerDraft, error) {
	prompt = strings.TrimSpace(prompt)
	if isContainerIntent(prompt) {
		return containerInspectionDraft(prompt), nil
	}
	generated, err := u.GenerateGraph(ctx, prompt)
	if err != nil {
		return PlannerDraft{}, err
	}
	g, err := ParseGraph(generated.GraphJSON)
	if err != nil {
		return PlannerDraft{}, err
	}
	return makePlannerDraft(generated.Name, generated.Description, generated.GraphJSON, g, "planner", ""), nil
}

func isContainerIntent(prompt string) bool {
	p := strings.ToLower(prompt)
	return strings.Contains(p, "docker") || strings.Contains(p, "container") || strings.Contains(prompt, "容器")
}

func containerInspectionDraft(prompt string) PlannerDraft {
	wantsReport := strings.Contains(prompt, "报告") || strings.Contains(strings.ToLower(prompt), "report") || strings.Contains(prompt, "RCA")
	nodes := []GraphNode{
		{ID: "trigger", Type: NodeTriggerManual, Name: "选择目标设备", Config: json.RawMessage(`{}`), Position: &Position{X: 80, Y: 160}},
		{ID: "container", Type: NodeAgent, Name: "容器运维专家", Config: json.RawMessage(`{"persona":"specialist-container","instruction":"检查设备 {{trigger.device_id}} 的 Docker 容器状态。先查询知识库，再执行 docker version、docker ps -a、docker stats --no-stream 等只读检查；输出异常容器、健康状态、退出码、重启次数、证据和建议。禁止执行任何修改操作。"}`), Position: &Position{X: 350, Y: 160}},
	}
	edges := []GraphEdge{{ID: "trigger-container", Source: "trigger", Target: "container", SourcePort: PortNext}}
	if wantsReport {
		nodes = append(nodes, GraphNode{ID: "summary", Type: NodeLLM, Name: "整理容器诊断报告", Config: json.RawMessage(`{"system":"你是安全运维报告助手。只依据已提供的诊断事实输出结构清晰的中文报告，不编造数据。","prompt":"将以下容器诊断结果整理为 RCA 摘要、影响、证据、建议和复查项：{{nodes.container.output.answer}}"}`), Position: &Position{X: 650, Y: 160}})
		edges = append(edges, GraphEdge{ID: "container-summary", Source: "container", Target: "summary", SourcePort: PortNext})
	}
	g := &Graph{Nodes: nodes, Edges: edges}
	raw, _ := json.Marshal(g)
	draft := makePlannerDraft("Docker 容器巡检", "使用容器运维专家对目标设备执行 Docker 只读诊断。", string(raw), g, "template", "docker-container-inspection")
	draft.Intent = "Docker 容器只读巡检"
	draft.Risks = append(draft.Risks, PlannerRisk{Level: "policy", Message: "目标 Edge 必须启用“Docker 只读巡检”安全策略；本流程不包含启动、停止、删除或更新容器操作。"})
	return draft
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
