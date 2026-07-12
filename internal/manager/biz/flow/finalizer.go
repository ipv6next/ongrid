package flow

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	investigator "github.com/ongridio/ongrid/internal/manager/biz/alert/investigator"
	bizapproval "github.com/ongridio/ongrid/internal/manager/biz/approval"
	alertmodel "github.com/ongridio/ongrid/internal/manager/model/alert"
	approvalmodel "github.com/ongridio/ongrid/internal/manager/model/approval"
	flowmodel "github.com/ongridio/ongrid/internal/manager/model/flow"
	reportmodel "github.com/ongridio/ongrid/internal/manager/model/report"
	"github.com/ongridio/ongrid/internal/pkg/errs"
)

// ProductSinks are optional native Ongrid domains a finished workflow can
// write into. Keeping them as narrow interfaces lets flow orchestration stay
// the driver without owning RCA / approval / report internals.
type ProductSinks struct {
	Investigations InvestigationSink
	Approvals      ApprovalSink
	Reports        ReportSink
}

type InvestigationSink interface {
	Create(ctx context.Context, rep *alertmodel.InvestigationReport) error
	GetByIncident(ctx context.Context, incidentID uint64) (*alertmodel.InvestigationReport, error)
	MarkReady(ctx context.Context, id string, fields investigator.ReadyFields) error
}

type ApprovalSink interface {
	Propose(ctx context.Context, in bizapproval.ProposeInput) (*approvalmodel.Approval, error)
}

type ReportSink interface {
	ArchiveReady(ctx context.Context, createdBy uint64, title, kind, tz, scopeJSON, contentMD, summary, locale, taskRef string, now time.Time) (*reportmodel.Report, error)
}

type flowArtifact struct {
	incidentID uint64
	answer     string
	title      string
	kind       string
	trigger    map[string]any
}

func (u *Usecase) finalizeProductArtifacts(ctx context.Context, f *flowmodel.Flow, run *flowmodel.FlowRun) error {
	if u == nil || run == nil || u.runs == nil {
		return nil
	}
	nodes, err := u.runs.ListNodes(ctx, run.ID)
	if err != nil {
		return err
	}
	artifact := buildFlowArtifact(f, run, nodes)
	if artifact.answer == "" {
		return nil
	}
	if artifact.kind == "alert" && artifact.incidentID > 0 {
		if err := u.finalizeRCA(ctx, run, artifact); err != nil {
			u.log.Warn("flow rca finalizer failed", "run_id", run.ID, "err", err)
		}
	}
	if shouldProposeApproval(artifact.answer) && artifact.incidentID > 0 {
		if err := u.finalizeApproval(ctx, run, artifact); err != nil {
			u.log.Warn("flow approval finalizer failed", "run_id", run.ID, "err", err)
		}
	}
	if artifact.kind == "alert" || artifact.kind == "patrol" || artifact.kind == "report" {
		if err := u.finalizeReport(ctx, run, artifact); err != nil {
			u.log.Warn("flow report finalizer failed", "run_id", run.ID, "err", err)
		}
	}
	return nil
}

func buildFlowArtifact(f *flowmodel.Flow, run *flowmodel.FlowRun, nodes []*flowmodel.FlowRunNode) flowArtifact {
	trigger := map[string]any{}
	if run.TriggerJSON != "" {
		_ = json.Unmarshal([]byte(run.TriggerJSON), &trigger)
	}
	answer := ""
	title := ""
	for _, n := range nodes {
		if n == nil || n.Status != flowmodel.NodeStatusSucceeded {
			continue
		}
		if n.NodeType != NodeAgent && n.NodeType != NodeLLM {
			continue
		}
		if got := answerFromOutput(n.OutputJSON); got != "" {
			answer = got
			title = n.NodeName
		}
	}
	if title == "" && f != nil {
		title = f.Name
	}
	return flowArtifact{
		incidentID: incidentIDFromTrigger(trigger),
		answer:     strings.TrimSpace(answer),
		title:      strings.TrimSpace(title),
		kind:       inferArtifactKind(f),
		trigger:    trigger,
	}
}

func answerFromOutput(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(raw), &obj); err != nil {
		return ""
	}
	if v, ok := obj["answer"].(string); ok {
		return strings.TrimSpace(v)
	}
	if v, ok := obj["text"].(string); ok {
		return strings.TrimSpace(v)
	}
	if v, ok := obj["result"].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

func incidentIDFromTrigger(trigger map[string]any) uint64 {
	for _, key := range []string{"incident_id", "incidentId"} {
		switch v := trigger[key].(type) {
		case float64:
			if v > 0 {
				return uint64(v)
			}
		case int:
			if v > 0 {
				return uint64(v)
			}
		case uint64:
			return v
		case string:
			var id uint64
			if _, err := fmt.Sscanf(strings.TrimSpace(v), "%d", &id); err == nil {
				return id
			}
		}
	}
	return 0
}

func inferArtifactKind(f *flowmodel.Flow) string {
	if f == nil {
		return "manual"
	}
	text := strings.ToLower(f.Name + " " + f.Description)
	switch {
	case strings.Contains(text, "[\u7c7b\u578b:\u5de1\u68c0]") || strings.Contains(text, "\u5de1\u68c0") || strings.Contains(text, "patrol"):
		return "patrol"
	case strings.Contains(text, "[\u7c7b\u578b:\u62a5\u544a]") || strings.Contains(text, "\u62a5\u544a") || strings.Contains(text, "\u5f52\u6863") || strings.Contains(text, "report"):
		return "report"
	case strings.Contains(text, "[\u7c7b\u578b:\u4eba\u5de5\u786e\u8ba4]") || strings.Contains(text, "\u4eba\u5de5\u786e\u8ba4") || strings.Contains(text, "approval") || strings.Contains(text, "review"):
		return "approval"
	case strings.Contains(text, "[\u7c7b\u578b:\u544a\u8b66]") || strings.Contains(text, "\u544a\u8b66") || strings.Contains(text, "incident") || strings.Contains(text, "rca"):
		return "alert"
	default:
		return "manual"
	}
}

func (u *Usecase) finalizeRCA(ctx context.Context, run *flowmodel.FlowRun, artifact flowArtifact) error {
	if u.sinks.Investigations == nil {
		return nil
	}
	rep, err := u.sinks.Investigations.GetByIncident(ctx, artifact.incidentID)
	if err != nil {
		if !errors.Is(err, errs.ErrNotFound) {
			return err
		}
		rep = &alertmodel.InvestigationReport{
			IncidentID:            artifact.incidentID,
			Status:                alertmodel.InvestigationStatusPending,
			StatusReason:          "",
			PinpointedTargetJSON:  "{}",
			RelatedAlertsJSON:     "[]",
			EvidenceJSON:          "[]",
			SuggestedActionsJSON:  "[]",
			FindingsMD:            "",
			ConfidenceFactorsJSON: "{}",
			ToolCallCount:         0,
		}
		if err := u.sinks.Investigations.Create(ctx, rep); err != nil {
			if !errors.Is(err, errs.ErrConflict) {
				return err
			}
			rep, err = u.sinks.Investigations.GetByIncident(ctx, artifact.incidentID)
			if err != nil {
				return err
			}
		}
	}
	conf := 0.75
	if rep.Confidence != nil {
		conf = *rep.Confidence
	}
	rootCause := firstLineOrSummary(artifact.answer, 220)
	if rep.RootCause != "" {
		rootCause = rep.RootCause
	}
	findings := workflowMarkdown("RCA \u5de5\u4f5c\u6d41\u8f93\u51fa", run, artifact)
	if strings.TrimSpace(rep.FindingsMD) != "" {
		findings = strings.TrimSpace(rep.FindingsMD) + "\n\n---\n\n" + findings
	}
	fields := investigator.ReadyFields{
		RootCause:             rootCause,
		AffectedWindow:        rep.AffectedWindow,
		PinpointedTargetJSON:  defaultJSON(rep.PinpointedTargetJSON, "{}"),
		RelatedAlertsJSON:     defaultJSON(rep.RelatedAlertsJSON, "[]"),
		EvidenceJSON:          appendJSONArray(rep.EvidenceJSON, evidenceJSON(run, artifact)),
		SuggestedActionsJSON:  appendJSONArray(rep.SuggestedActionsJSON, suggestedActionsJSON(artifact.answer)),
		FindingsMD:            findings,
		Confidence:            &conf,
		ConfidenceFactorsJSON: `{"source":"workflow","has_workflow_run":true,"structured_extraction":false}`,
		ToolCallCount:         rep.ToolCallCount,
	}
	return u.sinks.Investigations.MarkReady(ctx, rep.ID, fields)
}

func (u *Usecase) finalizeApproval(ctx context.Context, run *flowmodel.FlowRun, artifact flowArtifact) error {
	if u.sinks.Approvals == nil {
		return nil
	}
	title := fmt.Sprintf("\u786e\u8ba4\u4e8b\u4ef6 #%d \u7684\u9ad8\u98ce\u9669\u5efa\u8bae\u52a8\u4f5c", artifact.incidentID)
	_, err := u.sinks.Approvals.Propose(ctx, bizapproval.ProposeInput{
		Kind:    "suggested_action",
		Title:   title,
		Summary: firstLineOrSummary(artifact.answer, 260),
		Payload: map[string]any{
			"incident_id": artifact.incidentID,
			"flow_run_id": run.ID,
			"trigger":     artifact.trigger,
			"source":      "workflow",
			"suggestion":  artifact.answer,
			"action_type": "manual",
		},
		Source:         "flow",
		SessionID:      run.ID,
		ProposedBy:     createdBy(run),
		IncidentID:     artifact.incidentID,
		SourceType:     approvalmodel.SourceWorkflow,
		RiskLevel:      "high",
		ActionType:     "manual",
		Recommendation: firstLineOrSummary(artifact.answer, 500),
		Prerequisites:  []string{"确认事件上下文和影响范围", "确认已有回滚方案和执行窗口"},
	})
	return err
}

func (u *Usecase) finalizeReport(ctx context.Context, run *flowmodel.FlowRun, artifact flowArtifact) error {
	if u.sinks.Reports == nil {
		return nil
	}
	title := reportTitle(artifact)
	scope, _ := json.Marshal(map[string]any{
		"source":      "workflow",
		"flow_run_id": run.ID,
		"incident_id": artifact.incidentID,
		"kind":        artifact.kind,
	})
	_, err := u.sinks.Reports.ArchiveReady(
		ctx,
		createdBy(run),
		title,
		reportmodel.KindCustom,
		"Asia/Shanghai",
		string(scope),
		workflowMarkdown(title, run, artifact),
		firstLineOrSummary(artifact.answer, 260),
		"zh",
		"workflow:"+run.ID,
		time.Now().UTC(),
	)
	return err
}

func createdBy(run *flowmodel.FlowRun) uint64 {
	if run != nil && run.CreatedBy != nil {
		return *run.CreatedBy
	}
	return 0
}

func evidenceJSON(run *flowmodel.FlowRun, artifact flowArtifact) string {
	rows := []map[string]any{{
		"step":     "workflow_run",
		"summary":  firstLineOrSummary(artifact.answer, 220),
		"run_id":   run.ID,
		"source":   "workflow",
		"category": artifact.kind,
	}}
	b, _ := json.Marshal(rows)
	return string(b)
}

func suggestedActionsJSON(answer string) string {
	action := map[string]any{
		"label":    firstLineOrSummary(answer, 160),
		"category": "observe",
		"danger":   "low",
	}
	if shouldProposeApproval(answer) {
		action["category"] = "mutate"
		action["danger"] = "high"
	}
	b, _ := json.Marshal([]map[string]any{action})
	return string(b)
}

func defaultJSON(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}

func appendJSONArray(existing, extra string) string {
	var cur []any
	if strings.TrimSpace(existing) != "" {
		_ = json.Unmarshal([]byte(existing), &cur)
	}
	var add []any
	if strings.TrimSpace(extra) != "" {
		_ = json.Unmarshal([]byte(extra), &add)
	}
	if len(cur) == 0 && len(add) == 0 {
		return "[]"
	}
	cur = append(cur, add...)
	b, err := json.Marshal(cur)
	if err != nil {
		return "[]"
	}
	return string(b)
}

func workflowMarkdown(title string, run *flowmodel.FlowRun, artifact flowArtifact) string {
	var b strings.Builder
	b.WriteString("# ")
	b.WriteString(title)
	b.WriteString("\n\n")
	if artifact.incidentID > 0 {
		fmt.Fprintf(&b, "- \u4e8b\u4ef6: #%d\n", artifact.incidentID)
	}
	fmt.Fprintf(&b, "- Workflow Run: `%s`\n", run.ID)
	fmt.Fprintf(&b, "- \u7c7b\u578b: %s\n\n", artifact.kind)
	b.WriteString("## \u8f93\u51fa\n\n")
	b.WriteString(strings.TrimSpace(artifact.answer))
	b.WriteString("\n")
	return b.String()
}

func reportTitle(artifact flowArtifact) string {
	switch artifact.kind {
	case "patrol":
		return "\u5b89\u5168\u5de1\u68c0\u62a5\u544a"
	case "report":
		if artifact.incidentID > 0 {
			return fmt.Sprintf("RCA \u5f52\u6863\u62a5\u544a #%d", artifact.incidentID)
		}
		return "RCA \u5f52\u6863\u62a5\u544a"
	case "alert":
		if artifact.incidentID > 0 {
			return fmt.Sprintf("RCA \u62a5\u544a #%d", artifact.incidentID)
		}
		return "RCA \u62a5\u544a"
	default:
		return "\u5de5\u4f5c\u6d41\u62a5\u544a"
	}
}

func firstLineOrSummary(s string, max int) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "\u5de5\u4f5c\u6d41\u5df2\u5b8c\u6210"
	}
	line := s
	if idx := strings.IndexAny(s, "\r\n"); idx >= 0 {
		line = strings.TrimSpace(s[:idx])
	}
	line = strings.Trim(line, "#*`- \t")
	line = strings.TrimSpace(line)
	if line == "" {
		line = strings.TrimSpace(s)
	}
	rs := []rune(line)
	if max > 0 && len(rs) > max {
		return string(rs[:max]) + "..."
	}
	return line
}

var highRiskPattern = regexp.MustCompile(`(?i)(\x{9ad8}\x{98ce}\x{9669}|\x{4eba}\x{5de5}\x{786e}\x{8ba4}|\x{5ba1}\x{6279}|approve|approval|restart|\x{91cd}\x{542f}|disable|\x{7981}\x{7528}|delete|\x{5220}\x{9664}|drop|truncate|\x{4fee}\x{6539}|\x{53d8}\x{66f4}|mutate|write|\x{5371}\x{9669})`)

func shouldProposeApproval(answer string) bool {
	return highRiskPattern.MatchString(answer)
}
