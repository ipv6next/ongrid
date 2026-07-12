package tools

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	devicebiz "github.com/ongridio/ongrid/internal/manager/biz/device"
	edgebiz "github.com/ongridio/ongrid/internal/manager/biz/edge"
	devicemodel "github.com/ongridio/ongrid/internal/manager/model/device"
	edgemodel "github.com/ongridio/ongrid/internal/manager/model/edge"
)

func TestQueryEdgesTool_Info(t *testing.T) {
	uc := edgebiz.NewUsecase(newFakeEdgeRepo(), nil, nil, slog.Default())
	tool := NewQueryEdgesTool(nil, uc, nil)
	info, err := tool.Info(context.Background())
	if err != nil {
		t.Fatalf("Info: %v", err)
	}
	if info.Name != ToolNameQueryEdges {
		t.Errorf("Name = %q", info.Name)
	}
	if !strings.Contains(strings.ToLower(info.WhenToUse), "not") {
		t.Errorf("WhenToUse needs reverse guard")
	}
}

func TestQueryEdgesTool_LegacyEdgeFallback(t *testing.T) {
	// devices nil → falls back to edges path.
	e1 := &edgemodel.Edge{ID: 1, Name: "alpha", Status: "online"}
	e2 := &edgemodel.Edge{ID: 2, Name: "beta", Status: "offline"}
	uc := edgebiz.NewUsecase(newFakeEdgeRepo(e1, e2), nil, nil, slog.Default())
	tool := NewQueryEdgesTool(nil, uc, nil)

	out, err := tool.InvokableRun(context.Background(), `{}`)
	if err != nil {
		t.Fatalf("InvokableRun: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	devs, _ := got["devices"].([]any)
	if len(devs) == 0 {
		t.Errorf("expected devices in response")
	}
}

func TestQueryEdgesTool_ReturnsAssetProfileAndFiltersBusinessContext(t *testing.T) {
	devRepo := newFakeDeviceRepoForTools(
		&devicemodel.Device{
			ID:             10,
			Name:           "pay-prod-01",
			Hostname:       "pay-prod-01",
			Online:         true,
			Roles:          devicemodel.RoleBitServer | devicemodel.RoleBitDatabase,
			BusinessSystem: "Payment",
			Environment:    "生产",
			Owner:          "secops",
			Criticality:    "核心",
			SecurityLevel:  "等保三级",
			Tags:           "internet-facing,database",
		},
		&devicemodel.Device{ID: 11, Name: "oa-test-01", Hostname: "oa-test-01", BusinessSystem: "OA", Environment: "测试"},
	)
	devUC := devicebiz.NewUsecase(devRepo, nil, slog.Default())
	tool := NewQueryEdgesTool(devUC, nil, nil)

	out, err := tool.InvokableRun(context.Background(), `{"business_system":"Pay","environment":"生产"}`)
	if err != nil {
		t.Fatalf("InvokableRun: %v", err)
	}
	var got struct {
		Count   int `json:"count"`
		Devices []struct {
			ID           uint64        `json:"device_id"`
			AssetProfile *AssetProfile `json:"asset_profile"`
		} `json:"devices"`
	}
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Count != 1 || len(got.Devices) != 1 || got.Devices[0].ID != 10 {
		t.Fatalf("unexpected devices: %+v", got)
	}
	profile := got.Devices[0].AssetProfile
	if profile == nil || profile.BusinessSystem != "Payment" || profile.Environment != "生产" ||
		profile.Owner != "secops" || profile.Criticality != "核心" || profile.SecurityLevel != "等保三级" {
		t.Fatalf("asset_profile not populated: %+v", profile)
	}
	if len(profile.Tags) != 2 || profile.Tags[0] != "internet-facing" || profile.Tags[1] != "database" {
		t.Fatalf("tags = %+v", profile.Tags)
	}
}

func TestQueryEdgesTool_BadArgs(t *testing.T) {
	uc := edgebiz.NewUsecase(newFakeEdgeRepo(), nil, nil, slog.Default())
	tool := NewQueryEdgesTool(nil, uc, nil)
	if _, err := tool.InvokableRun(context.Background(), `not json`); err == nil {
		t.Errorf("expected error for non-JSON")
	}
}

func TestQueryEdgesTool_NilDeps(t *testing.T) {
	tool := NewQueryEdgesTool(nil, nil, nil)
	_, err := tool.InvokableRun(context.Background(), `{}`)
	if err == nil {
		t.Errorf("expected error when both devices and edges are nil")
	}
}
