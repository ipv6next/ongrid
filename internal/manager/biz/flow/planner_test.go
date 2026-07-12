package flow

import (
	"context"
	"strings"
	"testing"
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
