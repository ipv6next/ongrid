package tools

import (
	"strings"

	devicemodel "github.com/ongridio/ongrid/internal/manager/model/device"
)

// AssetProfile is the operator-owned business context surfaced to the LLM.
// It is intentionally small and non-secret: enough for triage priority,
// blast-radius wording and routing, without exposing credentials or access keys.
type AssetProfile struct {
	BusinessSystem    string   `json:"business_system,omitempty"`
	Environment       string   `json:"environment,omitempty"`
	Region            string   `json:"region,omitempty"`
	Datacenter        string   `json:"datacenter,omitempty"`
	CloudProvider     string   `json:"cloud_provider,omitempty"`
	Owner             string   `json:"owner,omitempty"`
	Criticality       string   `json:"criticality,omitempty"`
	SecurityLevel     string   `json:"security_level,omitempty"`
	MaintenanceWindow string   `json:"maintenance_window,omitempty"`
	Tags              []string `json:"tags,omitempty"`
}

func assetProfileFromDevice(d *devicemodel.Device) *AssetProfile {
	if d == nil {
		return nil
	}
	p := &AssetProfile{
		BusinessSystem:    strings.TrimSpace(d.BusinessSystem),
		Environment:       strings.TrimSpace(d.Environment),
		Region:            strings.TrimSpace(d.Region),
		Datacenter:        strings.TrimSpace(d.Datacenter),
		CloudProvider:     strings.TrimSpace(d.CloudProvider),
		Owner:             strings.TrimSpace(d.Owner),
		Criticality:       strings.TrimSpace(d.Criticality),
		SecurityLevel:     strings.TrimSpace(d.SecurityLevel),
		MaintenanceWindow: strings.TrimSpace(d.MaintenanceWindow),
		Tags:              splitAssetTags(d.Tags),
	}
	if p.BusinessSystem == "" && p.Environment == "" && p.Owner == "" &&
		p.Region == "" && p.Datacenter == "" && p.CloudProvider == "" &&
		p.Criticality == "" && p.SecurityLevel == "" && p.MaintenanceWindow == "" && len(p.Tags) == 0 {
		return nil
	}
	return p
}

func splitAssetTags(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		tag := strings.TrimSpace(part)
		if tag != "" {
			out = append(out, tag)
		}
	}
	return out
}
