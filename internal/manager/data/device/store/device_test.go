package store

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	biz "github.com/ongridio/ongrid/internal/manager/biz/device"
	model "github.com/ongridio/ongrid/internal/manager/model/device"
	edgemodel "github.com/ongridio/ongrid/internal/manager/model/edge"
)

func newDeviceTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("gorm.Open sqlite :memory:: %v", err)
	}
	if err := Migrate(db); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	return db
}

func sampleDevice(fingerprint string) *model.Device {
	return &model.Device{
		Fingerprint:    fingerprint,
		Name:           fingerprint,
		Hostname:       fingerprint,
		OS:             "linux",
		Arch:           "amd64",
		KernelVersion:  "6.8.0",
		CPUCount:       2,
		MemTotalBytes:  4096,
		DiskTotalBytes: 8192,
	}
}

func TestFindOrCreateByFingerprintSoftDeleteAllowsReuse(t *testing.T) {
	db := newDeviceTestDB(t)
	repo := NewRepo(db)
	ctx := context.Background()

	first, err := repo.FindOrCreateByFingerprint(ctx, sampleDevice("host-a"))
	if err != nil {
		t.Fatalf("first FindOrCreateByFingerprint: %v", err)
	}

	again, err := repo.FindOrCreateByFingerprint(ctx, sampleDevice("host-a"))
	if err != nil {
		t.Fatalf("second FindOrCreateByFingerprint: %v", err)
	}
	if again.ID != first.ID {
		t.Fatalf("active duplicate created id %d, want existing id %d", again.ID, first.ID)
	}

	if err := repo.Delete(ctx, first.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	recreated, err := repo.FindOrCreateByFingerprint(ctx, sampleDevice("host-a"))
	if err != nil {
		t.Fatalf("recreate after soft delete: %v", err)
	}
	if recreated.ID == first.ID {
		t.Fatalf("recreated row reused soft-deleted id %d", first.ID)
	}
	if n, err := repo.Count(ctx); err != nil || n != 1 {
		t.Fatalf("Count after recreate = %d, %v; want 1,nil", n, err)
	}
}

func TestUpdateProfilePersistsAssetMetadata(t *testing.T) {
	db := newDeviceTestDB(t)
	repo := NewRepo(db)
	ctx := context.Background()

	dev, err := repo.FindOrCreateByFingerprint(ctx, sampleDevice("asset-a"))
	if err != nil {
		t.Fatalf("FindOrCreateByFingerprint: %v", err)
	}
	if err := repo.UpdateProfile(ctx, dev.ID, biz.Profile{
		Name:           "pay-prod-01",
		Description:    "payment api host",
		BusinessSystem: "Payment",
		Environment:    "生产",
		Owner:          "secops",
		Criticality:    "核心",
		SecurityLevel:  "等保三级",
		Tags:           []string{"internet-facing", "database"},
	}); err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}

	got, err := repo.Get(ctx, dev.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Name != "pay-prod-01" ||
		got.BusinessSystem != "Payment" ||
		got.Environment != "生产" ||
		got.Owner != "secops" ||
		got.Criticality != "核心" ||
		got.SecurityLevel != "等保三级" ||
		got.Tags != "internet-facing,database" {
		t.Fatalf("profile not persisted: %#v", got)
	}
}

func TestListFiltersAssetMetadata(t *testing.T) {
	db := newDeviceTestDB(t)
	repo := NewRepo(db)
	ctx := context.Background()

	pay, err := repo.FindOrCreateByFingerprint(ctx, sampleDevice("pay-prod-01"))
	if err != nil {
		t.Fatalf("create pay: %v", err)
	}
	if err := repo.UpdateProfile(ctx, pay.ID, biz.Profile{
		Name:           "pay-prod-01",
		BusinessSystem: "Payment",
		Environment:    "生产",
		Owner:          "secops",
		Criticality:    "核心",
	}); err != nil {
		t.Fatalf("profile pay: %v", err)
	}
	oa, err := repo.FindOrCreateByFingerprint(ctx, sampleDevice("oa-test-01"))
	if err != nil {
		t.Fatalf("create oa: %v", err)
	}
	if err := repo.UpdateProfile(ctx, oa.ID, biz.Profile{
		Name:           "oa-test-01",
		BusinessSystem: "OA",
		Environment:    "测试",
		Owner:          "it",
		Criticality:    "低",
	}); err != nil {
		t.Fatalf("profile oa: %v", err)
	}

	rows, err := repo.List(ctx, biz.ListFilter{
		BusinessSystem: "Pay",
		Environment:    "生产",
		Criticality:    "核心",
		Limit:          10,
	})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(rows) != 1 || rows[0].ID != pay.ID {
		t.Fatalf("rows = %+v, want only pay", rows)
	}
}

func TestEdgeDeviceLinkSoftDeleteAllowsReuse(t *testing.T) {
	db := newDeviceTestDB(t)
	repo := NewEdgeDeviceRepo(db)
	ctx := context.Background()

	if err := repo.Link(ctx, 1, 2, model.EdgeDeviceRelationHost); err != nil {
		t.Fatalf("first Link: %v", err)
	}
	if err := repo.Link(ctx, 1, 2, model.EdgeDeviceRelationHost); err != nil {
		t.Fatalf("duplicate active Link should be idempotent: %v", err)
	}
	rows, err := repo.ListDevicesForEdge(ctx, 1)
	if err != nil {
		t.Fatalf("ListDevicesForEdge: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("active duplicate link count = %d, want 1", len(rows))
	}

	if err := repo.Unlink(ctx, 1, 2, model.EdgeDeviceRelationHost); err != nil {
		t.Fatalf("Unlink: %v", err)
	}
	if err := repo.Link(ctx, 1, 2, model.EdgeDeviceRelationHost); err != nil {
		t.Fatalf("relink after soft delete: %v", err)
	}
	rows, err = repo.ListDevicesForEdge(ctx, 1)
	if err != nil {
		t.Fatalf("ListDevicesForEdge after relink: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("active relink count = %d, want 1", len(rows))
	}
}

func TestReconcileOfflineOrphans(t *testing.T) {
	db := newDeviceTestDB(t)
	// The device store Migrate creates devices + edge_devices; the reconcile
	// join also needs the edges table.
	if err := db.AutoMigrate(&edgemodel.Edge{}); err != nil {
		t.Fatalf("AutoMigrate edges: %v", err)
	}
	repo := NewRepo(db)
	ctx := context.Background()

	mkOnlineDevice := func(fp string) uint64 {
		d, err := repo.FindOrCreateByFingerprint(ctx, sampleDevice(fp))
		if err != nil {
			t.Fatalf("create device %s: %v", fp, err)
		}
		if err := repo.MarkOnline(ctx, d.ID); err != nil {
			t.Fatalf("MarkOnline %s: %v", fp, err)
		}
		return d.ID
	}
	linkEdge := func(ak, status string, deviceID uint64, deleted bool) {
		e := &edgemodel.Edge{AccessKeyID: ak, SecretKeyHash: "x", Status: status}
		if err := db.Create(e).Error; err != nil {
			t.Fatalf("create edge %s: %v", ak, err)
		}
		if err := db.Create(&model.EdgeDevice{EdgeID: e.ID, DeviceID: deviceID, Type: model.EdgeDeviceRelationHost}).Error; err != nil {
			t.Fatalf("link edge %s: %v", ak, err)
		}
		if deleted {
			if err := db.Delete(&edgemodel.Edge{}, e.ID).Error; err != nil {
				t.Fatalf("soft-delete edge %s: %v", ak, err)
			}
		}
	}

	devOnline := mkOnlineDevice("dev-online")    // online edge linked -> stays online
	devOffEdge := mkOnlineDevice("dev-off-edge") // offline edge linked -> flipped offline
	devDelEdge := mkOnlineDevice("dev-del-edge") // edge soft-deleted -> flipped offline
	devNoEdge := mkOnlineDevice("dev-no-edge")   // no edge at all -> flipped offline

	linkEdge("ak-online", "online", devOnline, false)
	linkEdge("ak-offline", "offline", devOffEdge, false)
	linkEdge("ak-deleted", "online", devDelEdge, true) // online status but deleted row

	n, err := repo.ReconcileOfflineOrphans(ctx)
	if err != nil {
		t.Fatalf("ReconcileOfflineOrphans: %v", err)
	}
	if n != 3 {
		t.Errorf("flipped count = %d, want 3 (off-edge, del-edge, no-edge)", n)
	}

	assertOnline := func(id uint64, want bool, label string) {
		d, err := repo.Get(ctx, id)
		if err != nil {
			t.Fatalf("Get %s: %v", label, err)
		}
		if d.Online != want {
			t.Errorf("%s online=%v, want %v", label, d.Online, want)
		}
	}
	assertOnline(devOnline, true, "dev-online")
	assertOnline(devOffEdge, false, "dev-off-edge")
	assertOnline(devDelEdge, false, "dev-del-edge")
	assertOnline(devNoEdge, false, "dev-no-edge")

	// Idempotent: a second pass flips nothing (the live device stays online,
	// the rest are already offline).
	n2, err := repo.ReconcileOfflineOrphans(ctx)
	if err != nil {
		t.Fatalf("second reconcile: %v", err)
	}
	if n2 != 0 {
		t.Errorf("second reconcile flipped %d, want 0 (idempotent)", n2)
	}
}
