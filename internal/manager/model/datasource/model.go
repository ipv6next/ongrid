package datasource

import "time"

// DataSource is an external or built-in observation backend that assets can
// bind to. It intentionally starts narrow: Prometheus and Loki cover the
// current product path while leaving room for CMDB, OpenSearch, SNMP, etc.
type DataSource struct {
	ID          uint64 `gorm:"primaryKey;autoIncrement"`
	Name        string `gorm:"size:128;not null;column:name;uniqueIndex:idx_datasources_name"`
	Type        string `gorm:"size:32;not null;column:type;index:idx_datasources_type"` // prometheus | loki | cmdb | other
	URL         string `gorm:"size:512;not null;column:url"`
	AuthType    string `gorm:"size:32;not null;default:'none';column:auth_type"` // none | basic | bearer
	Username    string `gorm:"size:128;not null;default:'';column:username"`
	SecretRef   string `gorm:"size:128;not null;default:'';column:secret_ref"`
	TLSInsecure bool   `gorm:"not null;default:false;column:tls_insecure"`
	LabelMap    string `gorm:"type:text;column:label_map"`
	Builtin     bool   `gorm:"not null;default:false;column:builtin;index"`
	Enabled     bool   `gorm:"not null;default:true;column:enabled;index"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (DataSource) TableName() string { return "datasources" }
