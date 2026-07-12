package observability

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	dsstore "github.com/ongridio/ongrid/internal/manager/data/datasource/store"
	devicemodel "github.com/ongridio/ongrid/internal/manager/model/device"
	"github.com/ongridio/ongrid/internal/pkg/errs"
	"github.com/ongridio/ongrid/internal/pkg/logquery"
	"github.com/ongridio/ongrid/internal/pkg/promquery"
)

type DeviceRepo interface {
	Get(ctx context.Context, id uint64) (*devicemodel.Device, error)
}

type Handler struct {
	devices     DeviceRepo
	datasources *dsstore.Repo
	log         *slog.Logger
}

func NewHandler(devices DeviceRepo, datasources *dsstore.Repo, log *slog.Logger) *Handler {
	if log == nil {
		log = slog.Default()
	}
	return &Handler{devices: devices, datasources: datasources, log: log.With(slog.String("comp", "observability"))}
}

func (h *Handler) Register(r chi.Router) {
	r.Get("/v1/devices/{id}/observability/metrics", h.metrics)
	r.Get("/v1/devices/{id}/observability/logs", h.logs)
}

type datasourceDTO struct {
	ID      uint64 `json:"id"`
	Name    string `json:"name"`
	Type    string `json:"type"`
	Builtin bool   `json:"builtin"`
}

type metricPanel struct {
	Matrix json.RawMessage `json:"matrix"`
	Error  string          `json:"error,omitempty"`
}

type metricsResp struct {
	Matcher    string                 `json:"matcher"`
	DataSource *datasourceDTO         `json:"datasource,omitempty"`
	Panels     map[string]metricPanel `json:"panels"`
	From       string                 `json:"from"`
	To         string                 `json:"to"`
	Step       string                 `json:"step"`
}

type logsResp struct {
	Matcher    string          `json:"matcher"`
	Query      string          `json:"query"`
	DataSource *datasourceDTO  `json:"datasource,omitempty"`
	ResultType string          `json:"resultType"`
	Result     json.RawMessage `json:"result"`
	From       string          `json:"from"`
	To         string          `json:"to"`
}

func (h *Handler) metrics(w http.ResponseWriter, r *http.Request) {
	device, err := h.loadDevice(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	from, to, step, err := parseRange(r, 6*time.Hour, time.Minute)
	if err != nil {
		writeErr(w, err)
		return
	}
	ds, err := h.pickDatasource(r.Context(), device.MetricDatasourceID, "prometheus")
	if err != nil {
		writeErr(w, err)
		return
	}
	matcher, err := metricMatcher(device)
	if err != nil {
		writeErr(w, err)
		return
	}
	client := promquery.NewWithHTTPClient(ds.URL, httpClient(ds.TLSInsecure, 30*time.Second), h.log)
	exprs := map[string]string{
		"cpu":  fmt.Sprintf(`100 * (1 - rate(node_cpu_seconds_total{%s,mode="idle"}[5m]))`, matcher),
		"mem":  fmt.Sprintf(`100 * (1 - (node_memory_MemAvailable_bytes{%s} / node_memory_MemTotal_bytes{%s}))`, matcher, matcher),
		"disk": fmt.Sprintf(`100 * (1 - node_filesystem_avail_bytes{%s,fstype=~"ext4|xfs|btrfs|zfs|ext3|ext2|f2fs"} / node_filesystem_size_bytes{%s,fstype=~"ext4|xfs|btrfs|zfs|ext3|ext2|f2fs"})`, matcher, matcher),
	}
	panels := make(map[string]metricPanel, len(exprs))
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	for key, expr := range exprs {
		out, qerr := client.QueryRange(ctx, expr, from, to, step)
		if qerr != nil {
			panels[key] = metricPanel{Matrix: json.RawMessage(`[]`), Error: qerr.Error()}
			continue
		}
		panels[key] = metricPanel{Matrix: resultMatrix(out)}
	}
	writeJSON(w, http.StatusOK, metricsResp{
		Matcher:    matcher,
		DataSource: toDatasourceDTO(ds),
		Panels:     panels,
		From:       from.UTC().Format(time.RFC3339),
		To:         to.UTC().Format(time.RFC3339),
		Step:       step.String(),
	})
}

func (h *Handler) logs(w http.ResponseWriter, r *http.Request) {
	device, err := h.loadDevice(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	from, to, _, err := parseRange(r, time.Hour, time.Minute)
	if err != nil {
		writeErr(w, err)
		return
	}
	limit := 200
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, perr := strconv.Atoi(raw)
		if perr != nil || n <= 0 || n > 2000 {
			writeErr(w, fmt.Errorf("%w: limit must be 1..2000", errs.ErrInvalid))
			return
		}
		limit = n
	}
	ds, err := h.pickDatasource(r.Context(), device.LogDatasourceID, "loki")
	if err != nil {
		writeErr(w, err)
		return
	}
	matcher, err := logMatcher(device)
	if err != nil {
		writeErr(w, err)
		return
	}
	query := "{" + matcher + "}"
	if filter := strings.TrimSpace(r.URL.Query().Get("filter")); filter != "" {
		query += " " + filter
	}
	client := logquery.NewWithHTTPClient(ds.URL, httpClient(ds.TLSInsecure, 30*time.Second), h.log)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	out, err := client.QueryRange(ctx, logquery.QueryRangeOptions{
		Query:     query,
		Start:     from,
		End:       to,
		Limit:     limit,
		Direction: "backward",
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, logsResp{
		Matcher:    matcher,
		Query:      query,
		DataSource: toDatasourceDTO(ds),
		ResultType: out.ResultType,
		Result:     out.Result,
		From:       from.UTC().Format(time.RFC3339),
		To:         to.UTC().Format(time.RFC3339),
	})
}

func (h *Handler) loadDevice(r *http.Request) (*devicemodel.Device, error) {
	id, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id == 0 {
		return nil, fmt.Errorf("%w: invalid device id", errs.ErrInvalid)
	}
	if h.devices == nil {
		return nil, errs.ErrNotWiredYet
	}
	return h.devices.Get(r.Context(), id)
}

func (h *Handler) pickDatasource(ctx context.Context, preferred *uint64, typ string) (*datasourceRow, error) {
	if h.datasources == nil {
		return nil, errs.ErrNotWiredYet
	}
	if preferred != nil && *preferred != 0 {
		row, err := h.datasources.Get(ctx, *preferred)
		if err != nil {
			return nil, err
		}
		if row.Type != typ {
			return nil, fmt.Errorf("%w: datasource %d is %s, want %s", errs.ErrInvalid, row.ID, row.Type, typ)
		}
		if !row.Enabled {
			return nil, fmt.Errorf("%w: datasource %d is disabled", errs.ErrInvalid, row.ID)
		}
		return &datasourceRow{ID: row.ID, Name: row.Name, Type: row.Type, URL: strings.TrimRight(row.URL, "/"), TLSInsecure: row.TLSInsecure, Builtin: row.Builtin}, nil
	}
	rows, err := h.datasources.List(ctx)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if row.Type == typ && row.Enabled {
			return &datasourceRow{ID: row.ID, Name: row.Name, Type: row.Type, URL: strings.TrimRight(row.URL, "/"), TLSInsecure: row.TLSInsecure, Builtin: row.Builtin}, nil
		}
	}
	return nil, fmt.Errorf("%w: no enabled %s datasource", errs.ErrNotFound, typ)
}

type datasourceRow struct {
	ID          uint64
	Name        string
	Type        string
	URL         string
	TLSInsecure bool
	Builtin     bool
}

func metricMatcher(d *devicemodel.Device) (string, error) {
	if m := strings.TrimSpace(d.MetricMatcher); m != "" {
		return normalizeMatcher(m)
	}
	if d.ID != 0 {
		return fmt.Sprintf(`device_id="%d"`, d.ID), nil
	}
	return "", fmt.Errorf("%w: metric matcher is empty", errs.ErrInvalid)
}

func logMatcher(d *devicemodel.Device) (string, error) {
	if m := strings.TrimSpace(d.LogMatcher); m != "" {
		return normalizeMatcher(m)
	}
	if d.ID != 0 {
		return fmt.Sprintf(`device_id="%d"`, d.ID), nil
	}
	if d.Hostname != "" {
		return fmt.Sprintf(`host="%s"`, escapeLabelValue(d.Hostname)), nil
	}
	return "", fmt.Errorf("%w: log matcher is empty", errs.ErrInvalid)
}

var labelMatcherRe = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*\s*(=|!=|=~|!~)\s*"(?:\\.|[^"\\])*"$`)

func normalizeMatcher(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "{")
	s = strings.TrimSuffix(s, "}")
	parts := splitMatchers(s)
	if len(parts) == 0 {
		return "", fmt.Errorf("%w: matcher is empty", errs.ErrInvalid)
	}
	for _, part := range parts {
		if !labelMatcherRe.MatchString(strings.TrimSpace(part)) {
			return "", fmt.Errorf("%w: invalid label matcher %q", errs.ErrInvalid, part)
		}
	}
	return strings.Join(parts, ","), nil
}

func splitMatchers(s string) []string {
	var out []string
	var b strings.Builder
	inQuote := false
	escaped := false
	for _, r := range s {
		switch {
		case escaped:
			b.WriteRune(r)
			escaped = false
		case r == '\\' && inQuote:
			b.WriteRune(r)
			escaped = true
		case r == '"':
			b.WriteRune(r)
			inQuote = !inQuote
		case r == ',' && !inQuote:
			if part := strings.TrimSpace(b.String()); part != "" {
				out = append(out, part)
			}
			b.Reset()
		default:
			b.WriteRune(r)
		}
	}
	if part := strings.TrimSpace(b.String()); part != "" {
		out = append(out, part)
	}
	return out
}

func parseRange(r *http.Request, defaultWindow time.Duration, defaultStep time.Duration) (time.Time, time.Time, time.Duration, error) {
	q := r.URL.Query()
	to := time.Now().UTC()
	from := to.Add(-defaultWindow)
	var err error
	if raw := q.Get("end"); raw != "" {
		to, err = time.Parse(time.RFC3339, raw)
		if err != nil {
			return time.Time{}, time.Time{}, 0, fmt.Errorf("%w: end", errs.ErrInvalid)
		}
	}
	if raw := q.Get("start"); raw != "" {
		from, err = time.Parse(time.RFC3339, raw)
		if err != nil {
			return time.Time{}, time.Time{}, 0, fmt.Errorf("%w: start", errs.ErrInvalid)
		}
	}
	if !to.After(from) {
		return time.Time{}, time.Time{}, 0, fmt.Errorf("%w: end must be after start", errs.ErrInvalid)
	}
	step := defaultStep
	if raw := q.Get("step"); raw != "" {
		step, err = time.ParseDuration(raw)
		if err != nil || step <= 0 {
			return time.Time{}, time.Time{}, 0, fmt.Errorf("%w: invalid step", errs.ErrInvalid)
		}
	}
	return from.UTC(), to.UTC(), step, nil
}

func resultMatrix(out *promquery.InstantResult) json.RawMessage {
	if out == nil || len(out.Result) == 0 || out.ResultType != "matrix" {
		return json.RawMessage(`[]`)
	}
	return out.Result
}

func httpClient(tlsInsecure bool, timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: tlsInsecure}, //nolint:gosec
		},
	}
}

func toDatasourceDTO(row *datasourceRow) *datasourceDTO {
	if row == nil {
		return nil
	}
	return &datasourceDTO{ID: row.ID, Name: row.Name, Type: row.Type, Builtin: row.Builtin}
}

func escapeLabelValue(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, `\`, `\\`), `"`, `\"`)
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, err error) {
	status := errs.HTTPStatus(err)
	if status == http.StatusInternalServerError && !errors.Is(err, errs.ErrInvalid) {
		status = http.StatusBadGateway
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
