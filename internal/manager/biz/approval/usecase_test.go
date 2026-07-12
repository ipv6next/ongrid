package approval

import (
	"context"
	"testing"
	"time"

	model "github.com/ongridio/ongrid/internal/manager/model/approval"
)

type memoryRepo struct{ row *model.Approval }

func (r *memoryRepo) Create(_ context.Context, a *model.Approval) error        { r.row = a; return nil }
func (r *memoryRepo) Get(_ context.Context, _ string) (*model.Approval, error) { return r.row, nil }
func (r *memoryRepo) List(context.Context, string, int) ([]*model.Approval, error) {
	return []*model.Approval{r.row}, nil
}
func (r *memoryRepo) CountPending(context.Context) (int64, error) { return 1, nil }
func (r *memoryRepo) Decide(_ context.Context, _ string, fields map[string]any) error {
	r.row.Status = fields["status"].(string)
	if v, ok := fields["approved_by"].(uint64); ok {
		r.row.ApprovedBy = &v
	}
	return nil
}
func (r *memoryRepo) SetResult(_ context.Context, _ string, status, result string, at time.Time) error {
	r.row.Status, r.row.ResultJSON, r.row.ExecutedAt = status, &result, &at
	return nil
}

func TestSuggestedActionManualApprovalDoesNotExecute(t *testing.T) {
	repo := &memoryRepo{}
	uc := NewUsecase(repo, nil)
	executed := false
	uc.RegisterExecutor("suggested_action", func(context.Context, string) (string, error) {
		executed = true
		return `{}`, nil
	})
	a, err := uc.Propose(context.Background(), ProposeInput{
		Kind: "suggested_action", Title: "restart service", Payload: map[string]any{"service": "api"},
		IncidentID: 42, SourceType: model.SourceRCA, RiskLevel: "high",
		ActionType: "manual", Recommendation: "Restart after confirming the maintenance window",
		Prerequisites: []string{"backup", "rollback plan"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if a.IncidentID != 42 || a.SourceType != model.SourceRCA || a.RiskLevel != "high" {
		t.Fatalf("standard fields not preserved: %#v", a)
	}
	got, err := uc.Approve(context.Background(), 7, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if executed || got.Status != model.StatusApproved {
		t.Fatalf("manual action must stay approved without execution: executed=%v status=%s", executed, got.Status)
	}
}

func TestSuggestedActionSkillExecutesAfterApproval(t *testing.T) {
	repo := &memoryRepo{}
	uc := NewUsecase(repo, nil)
	uc.RegisterExecutor("suggested_action", func(context.Context, string) (string, error) {
		return `{"ok":true}`, nil
	})
	a, err := uc.Propose(context.Background(), ProposeInput{
		Kind: "suggested_action", Title: "run skill", Payload: map[string]any{"skill_key": "restart_service"},
		ActionType: "skill", RiskLevel: "high",
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := uc.Approve(context.Background(), 7, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != model.StatusExecuted || got.ResultJSON == nil {
		t.Fatalf("skill action should execute: %#v", got)
	}
}
