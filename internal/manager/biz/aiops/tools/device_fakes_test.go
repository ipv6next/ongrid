package tools

import (
	"context"
	"strings"

	devicebiz "github.com/ongridio/ongrid/internal/manager/biz/device"
	devicemodel "github.com/ongridio/ongrid/internal/manager/model/device"
	"github.com/ongridio/ongrid/internal/pkg/errs"
)

type fakeDeviceRepoForTools struct {
	byID map[uint64]*devicemodel.Device
}

func newFakeDeviceRepoForTools(devices ...*devicemodel.Device) *fakeDeviceRepoForTools {
	r := &fakeDeviceRepoForTools{byID: map[uint64]*devicemodel.Device{}}
	for _, d := range devices {
		r.byID[d.ID] = d
	}
	return r
}

func (r *fakeDeviceRepoForTools) FindOrCreateByFingerprint(_ context.Context, seed *devicemodel.Device) (*devicemodel.Device, error) {
	return seed, nil
}
func (r *fakeDeviceRepoForTools) RebindFingerprint(context.Context, string, string) error { return nil }
func (r *fakeDeviceRepoForTools) UpdateHostFacts(context.Context, uint64, devicebiz.HostFacts) error {
	return nil
}
func (r *fakeDeviceRepoForTools) UpdateUsage(context.Context, uint64, devicebiz.Usage) error {
	return nil
}
func (r *fakeDeviceRepoForTools) UpdateRoles(context.Context, uint64, uint8) error { return nil }
func (r *fakeDeviceRepoForTools) UpdateNameDescription(context.Context, uint64, string, string) error {
	return nil
}
func (r *fakeDeviceRepoForTools) UpdateProfile(context.Context, uint64, devicebiz.Profile) error {
	return nil
}
func (r *fakeDeviceRepoForTools) SetNodeID(context.Context, uint64, uint64) error { return nil }
func (r *fakeDeviceRepoForTools) MarkOnline(context.Context, uint64) error        { return nil }
func (r *fakeDeviceRepoForTools) MarkOffline(context.Context, uint64) error       { return nil }

func (r *fakeDeviceRepoForTools) Get(_ context.Context, id uint64) (*devicemodel.Device, error) {
	if d, ok := r.byID[id]; ok {
		return d, nil
	}
	return nil, errs.ErrNotFound
}

func (r *fakeDeviceRepoForTools) GetMany(_ context.Context, ids []uint64) (map[uint64]*devicemodel.Device, error) {
	out := make(map[uint64]*devicemodel.Device, len(ids))
	for _, id := range ids {
		if d, ok := r.byID[id]; ok {
			out[id] = d
		}
	}
	return out, nil
}

func (r *fakeDeviceRepoForTools) List(_ context.Context, f devicebiz.ListFilter) ([]*devicemodel.Device, error) {
	out := make([]*devicemodel.Device, 0, len(r.byID))
	for _, d := range r.byID {
		if f.Name != "" && !strings.Contains(d.Name, f.Name) && !strings.Contains(d.Hostname, f.Name) {
			continue
		}
		if f.BusinessSystem != "" && !strings.Contains(d.BusinessSystem, f.BusinessSystem) {
			continue
		}
		if f.Environment != "" && d.Environment != f.Environment {
			continue
		}
		if f.Region != "" && d.Region != f.Region {
			continue
		}
		if f.Datacenter != "" && !strings.Contains(d.Datacenter, f.Datacenter) {
			continue
		}
		if f.CloudProvider != "" && d.CloudProvider != f.CloudProvider {
			continue
		}
		if f.Owner != "" && !strings.Contains(d.Owner, f.Owner) {
			continue
		}
		if f.Criticality != "" && d.Criticality != f.Criticality {
			continue
		}
		if f.Online != nil && d.Online != *f.Online {
			continue
		}
		if f.RolesAny != 0 && d.Roles&f.RolesAny == 0 {
			continue
		}
		out = append(out, d)
		if f.Limit > 0 && len(out) >= f.Limit {
			break
		}
	}
	return out, nil
}

func (r *fakeDeviceRepoForTools) Count(context.Context) (int64, error) {
	return int64(len(r.byID)), nil
}
func (r *fakeDeviceRepoForTools) Delete(context.Context, uint64) error { return nil }
func (r *fakeDeviceRepoForTools) ReconcileOfflineOrphans(context.Context) (int64, error) {
	return 0, nil
}

type fakeEdgeDeviceRepoForTools struct {
	deviceToEdge map[uint64]uint64
}

func (r *fakeEdgeDeviceRepoForTools) Link(context.Context, uint64, uint64, devicemodel.EdgeDeviceRelationType) error {
	return nil
}
func (r *fakeEdgeDeviceRepoForTools) Unlink(context.Context, uint64, uint64, devicemodel.EdgeDeviceRelationType) error {
	return nil
}
func (r *fakeEdgeDeviceRepoForTools) LookupHostDevice(_ context.Context, edgeID uint64) (uint64, error) {
	for devID, eid := range r.deviceToEdge {
		if eid == edgeID {
			return devID, nil
		}
	}
	return 0, errs.ErrNotFound
}
func (r *fakeEdgeDeviceRepoForTools) LookupEdgeForDevice(_ context.Context, deviceID uint64, _ devicemodel.EdgeDeviceRelationType) (uint64, error) {
	if eid, ok := r.deviceToEdge[deviceID]; ok {
		return eid, nil
	}
	return 0, errs.ErrNotFound
}
func (r *fakeEdgeDeviceRepoForTools) ListDevicesForEdge(context.Context, uint64) ([]*devicemodel.EdgeDevice, error) {
	return nil, nil
}
func (r *fakeEdgeDeviceRepoForTools) ListEdgesForDevice(context.Context, uint64) ([]*devicemodel.EdgeDevice, error) {
	return nil, nil
}
