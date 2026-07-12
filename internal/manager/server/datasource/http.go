package datasource

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	store "github.com/ongridio/ongrid/internal/manager/data/datasource/store"
	model "github.com/ongridio/ongrid/internal/manager/model/datasource"
	"github.com/ongridio/ongrid/internal/pkg/errs"
	"github.com/ongridio/ongrid/internal/pkg/tenantctx"
)

const roleAdmin = "admin"

type Handler struct {
	repo *store.Repo
}

func NewHandler(repo *store.Repo) *Handler { return &Handler{repo: repo} }

func (h *Handler) Register(r chi.Router) {
	r.Get("/v1/datasources", h.list)
	r.With(h.requireAdmin).Post("/v1/datasources", h.create)
	r.With(h.requireAdmin).Put("/v1/datasources/{id}", h.update)
	r.With(h.requireAdmin).Delete("/v1/datasources/{id}", h.delete)
	r.With(h.requireAdmin).Post("/v1/datasources/{id}/test", h.test)
}

func (h *Handler) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t, ok := tenantctx.From(r.Context())
		if !ok {
			writeErr(w, errs.ErrUnauthorized)
			return
		}
		if t.Role != roleAdmin {
			writeErr(w, errs.ErrForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type item struct {
	ID          uint64 `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	URL         string `json:"url"`
	AuthType    string `json:"auth_type"`
	Username    string `json:"username,omitempty"`
	SecretRef   string `json:"secret_ref,omitempty"`
	TLSInsecure bool   `json:"tls_insecure"`
	LabelMap    string `json:"label_map,omitempty"`
	Builtin     bool   `json:"builtin"`
	Enabled     bool   `json:"enabled"`
	UpdatedAt   string `json:"updated_at,omitempty"`
}

type upsertReq struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	URL         string `json:"url"`
	AuthType    string `json:"auth_type"`
	Username    string `json:"username"`
	SecretRef   string `json:"secret_ref"`
	TLSInsecure bool   `json:"tls_insecure"`
	LabelMap    string `json:"label_map"`
	Enabled     *bool  `json:"enabled"`
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	if _, ok := tenantctx.From(r.Context()); !ok {
		writeErr(w, errs.ErrUnauthorized)
		return
	}
	rows, err := h.repo.List(r.Context())
	if err != nil {
		writeErr(w, err)
		return
	}
	out := make([]item, 0, len(rows))
	for _, row := range rows {
		out = append(out, toItem(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var in upsertReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, errors.Join(errs.ErrInvalid, err))
		return
	}
	row, err := reqToModel(in)
	if err != nil {
		writeErr(w, err)
		return
	}
	created, err := h.repo.Create(r.Context(), row)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, toItem(created))
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	var in upsertReq
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, errors.Join(errs.ErrInvalid, err))
		return
	}
	row, err := reqToModel(in)
	if err != nil {
		writeErr(w, err)
		return
	}
	updates := map[string]any{
		"name":         row.Name,
		"type":         row.Type,
		"url":          row.URL,
		"auth_type":    row.AuthType,
		"username":     row.Username,
		"secret_ref":   row.SecretRef,
		"tls_insecure": row.TLSInsecure,
		"label_map":    row.LabelMap,
		"enabled":      row.Enabled,
	}
	if err := h.repo.Update(r.Context(), id, updates); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := h.repo.Delete(r.Context(), id); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) test(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	row, err := h.repo.Get(r.Context(), id)
	if err != nil {
		writeErr(w, err)
		return
	}
	start := time.Now()
	if err := probe(r.Context(), row); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": false, "latency_ms": time.Since(start).Milliseconds(), "error": err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "latency_ms": time.Since(start).Milliseconds(),
	})
}

func reqToModel(in upsertReq) (*model.DataSource, error) {
	name := strings.TrimSpace(in.Name)
	typ := strings.ToLower(strings.TrimSpace(in.Type))
	rawURL := strings.TrimSpace(in.URL)
	if name == "" || typ == "" || rawURL == "" {
		return nil, fmt.Errorf("%w: name, type and url are required", errs.ErrInvalid)
	}
	if _, err := url.ParseRequestURI(rawURL); err != nil {
		return nil, errors.Join(errs.ErrInvalid, err)
	}
	switch typ {
	case "prometheus", "loki", "cmdb", "other":
	default:
		return nil, fmt.Errorf("%w: unsupported datasource type %q", errs.ErrInvalid, typ)
	}
	authType := strings.ToLower(strings.TrimSpace(in.AuthType))
	if authType == "" {
		authType = "none"
	}
	switch authType {
	case "none", "basic", "bearer":
	default:
		return nil, fmt.Errorf("%w: unsupported auth_type %q", errs.ErrInvalid, authType)
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	return &model.DataSource{
		Name:        name,
		Type:        typ,
		URL:         strings.TrimRight(rawURL, "/"),
		AuthType:    authType,
		Username:    strings.TrimSpace(in.Username),
		SecretRef:   strings.TrimSpace(in.SecretRef),
		TLSInsecure: in.TLSInsecure,
		LabelMap:    strings.TrimSpace(in.LabelMap),
		Enabled:     enabled,
	}, nil
}

func probe(ctx context.Context, row *model.DataSource) error {
	endpoint := strings.TrimRight(row.URL, "/")
	switch row.Type {
	case "prometheus":
		endpoint += "/api/v1/query?query=up"
	case "loki":
		endpoint += "/loki/api/v1/labels"
	default:
		endpoint += "/"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	client := &http.Client{
		Timeout:   5 * time.Second,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: row.TLSInsecure}}, //nolint:gosec
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("http status %d", resp.StatusCode)
	}
	return nil
}

func toItem(row *model.DataSource) item {
	return item{
		ID:          row.ID,
		Name:        row.Name,
		Type:        row.Type,
		URL:         row.URL,
		AuthType:    row.AuthType,
		Username:    row.Username,
		SecretRef:   row.SecretRef,
		TLSInsecure: row.TLSInsecure,
		LabelMap:    row.LabelMap,
		Builtin:     row.Builtin,
		Enabled:     row.Enabled,
		UpdatedAt:   row.UpdatedAt.Format(time.RFC3339),
	}
}

func parseID(r *http.Request) (uint64, error) {
	id, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		return 0, errors.Join(errs.ErrInvalid, err)
	}
	return id, nil
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, err error) {
	status := errs.HTTPStatus(err)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}
