package skill

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	bizaudit "github.com/ongridio/ongrid/internal/manager/biz/audit"
	svc "github.com/ongridio/ongrid/internal/manager/biz/skill"
	auditstore "github.com/ongridio/ongrid/internal/manager/data/audit/store"
	auditmodel "github.com/ongridio/ongrid/internal/manager/model/audit"
	auditmw "github.com/ongridio/ongrid/internal/manager/server/middleware"
	"github.com/ongridio/ongrid/internal/pkg/tenantctx"
)

type fakeSkillService struct {
	last svc.ExecuteInput
}

func (f *fakeSkillService) List(context.Context, svc.Caller, string) []svc.SkillSummary {
	return nil
}

func (f *fakeSkillService) Get(context.Context, svc.Caller, string) (*svc.SkillSummary, error) {
	return &svc.SkillSummary{}, nil
}

func (f *fakeSkillService) Execute(_ context.Context, _ svc.Caller, in svc.ExecuteInput) (*svc.ExecuteOutput, error) {
	f.last = in
	return &svc.ExecuteOutput{Result: json.RawMessage(`{"ok":true}`)}, nil
}

type captureAuditRepo struct {
	row *auditmodel.Log
}

func (r *captureAuditRepo) Insert(_ context.Context, row *auditmodel.Log) error {
	cp := *row
	r.row = &cp
	return nil
}

func (r *captureAuditRepo) List(context.Context, auditstore.ListFilters) ([]auditmodel.Log, int64, error) {
	return nil, 0, nil
}

func (r *captureAuditRepo) DeleteOlderThan(context.Context, time.Time) (int64, error) {
	return 0, nil
}

func TestExecuteSetsSkillAuditEvent(t *testing.T) {
	skills := &fakeSkillService{}
	audits := &captureAuditRepo{}

	r := chi.NewRouter()
	NewHandler(skills).Register(r)
	wrapped := auditmw.AuditMiddleware(bizaudit.New(audits, nil))(r)

	body := `{"edge_id":7,"params":{"cmd":"uptime","password":"secret","nested":{"api_key":"k","note":"ok"}}}`
	req := httptest.NewRequest(http.MethodPost, "/v1/skills/host_bash/execute", strings.NewReader(body))
	req = req.WithContext(tenantctx.With(req.Context(), tenantctx.Tenant{
		UserID: 42,
		Email:  "admin@example.test",
		Role:   "admin",
	}))
	rr := httptest.NewRecorder()

	wrapped.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}
	if skills.last.Key != "host_bash" || skills.last.EdgeID != 7 {
		t.Fatalf("Execute input = key %q edge %d", skills.last.Key, skills.last.EdgeID)
	}
	if audits.row == nil {
		t.Fatal("audit row not captured")
	}
	if audits.row.Action != auditmodel.ActionSkillExecute {
		t.Fatalf("audit action = %q", audits.row.Action)
	}
	if audits.row.ResourceType != auditmodel.ResourceSkill || audits.row.ResourceID != "host_bash" {
		t.Fatalf("audit resource = %s/%s", audits.row.ResourceType, audits.row.ResourceID)
	}
	if audits.row.Status != auditmodel.StatusSuccess {
		t.Fatalf("audit status = %q", audits.row.Status)
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(audits.row.PayloadJSON), &payload); err != nil {
		t.Fatalf("payload json: %v\n%s", err, audits.row.PayloadJSON)
	}
	params, ok := payload["params"].(map[string]any)
	if !ok {
		t.Fatalf("payload params missing/wrong: %#v", payload["params"])
	}
	if params["password"] != "<redacted>" {
		t.Fatalf("password was not redacted: %#v", params["password"])
	}
	nested, ok := params["nested"].(map[string]any)
	if !ok {
		t.Fatalf("nested params missing/wrong: %#v", params["nested"])
	}
	if nested["api_key"] != "<redacted>" || nested["note"] != "ok" {
		t.Fatalf("nested redaction wrong: %#v", nested)
	}
}
