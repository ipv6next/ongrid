package store

import (
	"os"

	model "github.com/ongridio/ongrid/internal/manager/model/datasource"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func Migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&model.DataSource{}); err != nil {
		return err
	}
	return seedBuiltin(db)
}

func seedBuiltin(db *gorm.DB) error {
	rows := []model.DataSource{
		{
			Name:     "内置 Prometheus",
			Type:     "prometheus",
			URL:      firstNonEmpty(os.Getenv("ONGRID_PROM_QUERY_URL"), "http://prometheus:9090"),
			AuthType: "none",
			Builtin:  true,
			Enabled:  true,
		},
		{
			Name:     "内置 Loki",
			Type:     "loki",
			URL:      firstNonEmpty(os.Getenv("ONGRID_LOKI_QUERY_URL"), "http://loki:3100"),
			AuthType: "none",
			Builtin:  true,
			Enabled:  true,
		},
	}
	for _, row := range rows {
		if err := db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "name"}},
			DoNothing: true,
		}).Create(&row).Error; err != nil {
			return err
		}
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
