package flow

import "testing"

func TestEnrichSuggestedActionContext(t *testing.T) {
	graph := `{"nodes":[{"config":{"instruction":"incident={{trigger.incident_id}} action={{trigger.action}} payload={{trigger.payload}}"}}]}`
	got := enrichSuggestedActionContext(graph, map[string]any{"incident_id": 42})

	if got["action"] == nil {
		t.Fatal("action should be derived from incident RCA context")
	}
	payload, ok := got["payload"].(map[string]any)
	if !ok || payload["incident_id"] != 42 {
		t.Fatalf("payload should carry incident context: %#v", got["payload"])
	}
	if missing := missingTriggerFields(graph, got); len(missing) != 0 {
		t.Fatalf("derived context should satisfy action/payload references: %v", missing)
	}
}

func TestEnrichSuggestedActionContextStillRequiresIncident(t *testing.T) {
	graph := `{"nodes":[{"config":{"instruction":"incident={{trigger.incident_id}} action={{trigger.action}} payload={{trigger.payload}}"}}]}`
	got := enrichSuggestedActionContext(graph, nil)
	missing := missingTriggerFields(graph, got)
	if len(missing) != 1 || missing[0] != "incident_id" {
		t.Fatalf("only incident_id should remain customer-supplied, got %v", missing)
	}
}
