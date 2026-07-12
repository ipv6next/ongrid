package flow

import (
	"context"
	"strings"
	"testing"

	flowmodel "github.com/ongridio/ongrid/internal/manager/model/flow"
)

func TestPlanWorkflow_ContainerUsesSpecialist(t *testing.T) {
	u := NewUsecase(nil, nil, nil, nil)
	draft, err := u.PlanWorkflow(context.Background(), "检查设备 5 的 Docker 容器状态并生成报告")
	if err != nil {
		t.Fatalf("PlanWorkflow() error = %v", err)
	}
	if draft.Mode != "template" || draft.TemplateKey != "docker-container-inspection" {
		t.Fatalf("unexpected template result: mode=%q key=%q", draft.Mode, draft.TemplateKey)
	}
	if !strings.Contains(draft.GraphJSON, `"persona":"specialist-container"`) {
		t.Fatalf("container plan did not select specialist-container: %s", draft.GraphJSON)
	}
	if !strings.Contains(draft.GraphJSON, `{{trigger.device_id}}`) {
		t.Fatalf("container plan must use runtime device input: %s", draft.GraphJSON)
	}
	if len(draft.RequiredInputs) != 1 || draft.RequiredInputs[0].Key != "device_id" {
		t.Fatalf("required inputs = %#v, want device_id", draft.RequiredInputs)
	}
	if len(draft.Risks) == 0 {
		t.Fatal("container plan should expose edge policy risk")
	}
}

func TestShouldArchiveWorkflowReport_RespectsPlannerMode(t *testing.T) {
	if shouldArchiveWorkflowReport(&flowmodel.Flow{Description: "[报告:web]"}) {
		t.Fatal("web report must not also create a native archive report")
	}
	if shouldArchiveWorkflowReport(&flowmodel.Flow{Description: "[报告:none]"}) {
		t.Fatal("report_mode=none must not create a native archive report")
	}
	if !shouldArchiveWorkflowReport(&flowmodel.Flow{Description: "[类型:告警]"}) {
		t.Fatal("existing workflows should keep archive behaviour")
	}
}

func TestPlanWorkflow_AlertUsesInvestigatorAndWebReport(t *testing.T) {
	u := NewUsecase(nil, nil, nil, nil)
	draft, err := u.PlanWorkflowWithOptions(context.Background(), "告警触发后自动调查", PlannerOptions{ReportMode: "web"})
	if err != nil {
		t.Fatalf("PlanWorkflowWithOptions() error = %v", err)
	}
	if draft.TemplateKey != "alert-auto-investigation" {
		t.Fatalf("template key = %q", draft.TemplateKey)
	}
	if !strings.Contains(draft.GraphJSON, `"persona":"incident-investigator"`) {
		t.Fatalf("alert plan did not select incident-investigator: %s", draft.GraphJSON)
	}
	if !strings.Contains(draft.GraphJSON, `"tool":"serve_page"`) {
		t.Fatalf("web report plan did not contain serve_page: %s", draft.GraphJSON)
	}
}

func TestPlanWorkflow_PatrolUsesRuntimeDevice(t *testing.T) {
	u := NewUsecase(nil, nil, nil, nil)
	draft, err := u.PlanWorkflowWithOptions(context.Background(), "生成安全巡检风险报告", PlannerOptions{ReportMode: "archive"})
	if err != nil {
		t.Fatalf("PlanWorkflowWithOptions() error = %v", err)
	}
	if draft.TemplateKey != "patrol-risk-report" {
		t.Fatalf("template key = %q", draft.TemplateKey)
	}
	if !strings.Contains(draft.GraphJSON, `"device_ids":["{{trigger.device_id}}"]`) {
		t.Fatalf("patrol plan did not use runtime device_ids: %s", draft.GraphJSON)
	}
}
