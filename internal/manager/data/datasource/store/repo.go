package store

import (
	"context"
	"errors"

	model "github.com/ongridio/ongrid/internal/manager/model/datasource"
	"github.com/ongridio/ongrid/internal/pkg/errs"
	"gorm.io/gorm"
)

type Repo struct {
	db *gorm.DB
}

func NewRepo(db *gorm.DB) *Repo { return &Repo{db: db} }

func (r *Repo) List(ctx context.Context) ([]*model.DataSource, error) {
	var rows []*model.DataSource
	if err := r.db.WithContext(ctx).Order("builtin DESC, id DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *Repo) Get(ctx context.Context, id uint64) (*model.DataSource, error) {
	var row model.DataSource
	if err := r.db.WithContext(ctx).First(&row, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errs.ErrNotFound
		}
		return nil, err
	}
	return &row, nil
}

func (r *Repo) Create(ctx context.Context, row *model.DataSource) (*model.DataSource, error) {
	if err := r.db.WithContext(ctx).Create(row).Error; err != nil {
		return nil, err
	}
	return row, nil
}

func (r *Repo) Update(ctx context.Context, id uint64, updates map[string]any) error {
	res := r.db.WithContext(ctx).Model(&model.DataSource{}).Where("id = ?", id).Updates(updates)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return errs.ErrNotFound
	}
	return nil
}

func (r *Repo) Delete(ctx context.Context, id uint64) error {
	res := r.db.WithContext(ctx).Where("builtin = ?", false).Delete(&model.DataSource{}, id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return errs.ErrNotFound
	}
	return nil
}
