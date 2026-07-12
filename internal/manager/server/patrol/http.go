// Package patrol exposes the first AI-SecOps security patrol surface.
// It reuses the existing edge bash.exec tunnel and read-only cmdpolicy
// sandbox instead of introducing a second remote-exec path.
package patrol

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	bizaudit "github.com/ongridio/ongrid/internal/manager/biz/audit"
	devicebiz "github.com/ongridio/ongrid/internal/manager/biz/device"
	auditmodel "github.com/ongridio/ongrid/internal/manager/model/audit"
	devicemodel "github.com/ongridio/ongrid/internal/manager/model/device"
	auditmw "github.com/ongridio/ongrid/internal/manager/server/middleware"
	"github.com/ongridio/ongrid/internal/pkg/errs"
	"github.com/ongridio/ongrid/internal/pkg/tenantctx"
	"github.com/ongridio/ongrid/internal/pkg/tunnel"
)

type EdgeCaller interface {
	Call(ctx context.Context, edgeID uint64, method string, body []byte) ([]byte, error)
}

type Handler struct {
	devices     devicebiz.Repo
	edgeDevices devicebiz.EdgeDeviceRepo
	caller      EdgeCaller
}

func NewHandler(devices devicebiz.Repo, edgeDevices devicebiz.EdgeDeviceRepo, caller EdgeCaller) *Handler {
	return &Handler{devices: devices, edgeDevices: edgeDevices, caller: caller}
}

func (h *Handler) Register(r chi.Router) {
	r.Post("/v1/security/patrol/run", h.run)
}

type runReq struct {
	DeviceID  uint64   `json:"device_id"`
	CheckKeys []string `json:"check_keys"`
}

type runResp struct {
	DeviceID    uint64        `json:"device_id"`
	DeviceName  string        `json:"device_name,omitempty"`
	Hostname    string        `json:"hostname,omitempty"`
	GeneratedAt time.Time     `json:"generated_at"`
	Summary     patrolSummary `json:"summary"`
	Checks      []checkResult `json:"checks"`
	Markdown    string        `json:"markdown"`
}

type patrolSummary struct {
	Total   int `json:"total"`
	Pass    int `json:"pass"`
	Warn    int `json:"warn"`
	Fail    int `json:"fail"`
	Unknown int `json:"unknown"`
}

type checkResult struct {
	Key        string `json:"key"`
	Title      string `json:"title"`
	Status     string `json:"status"`
	Severity   string `json:"severity"`
	Command    string `json:"command,omitempty"`
	Evidence   string `json:"evidence,omitempty"`
	Conclusion string `json:"conclusion"`
	Error      string `json:"error,omitempty"`
	DurationMS int64  `json:"duration_ms,omitempty"`
}

type patrolCheck struct {
	key      string
	title    string
	severity string
	cmd      string
	judge    func(out tunnel.BashExecResponse) (status, conclusion string)
}

func (h *Handler) run(w http.ResponseWriter, r *http.Request) {
	if _, ok := tenantctx.From(r.Context()); !ok {
		writeErr(w, errs.ErrUnauthorized)
		return
	}
	var req runReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, errors.Join(errs.ErrInvalid, err))
		return
	}
	if req.DeviceID == 0 {
		writeErr(w, fmt.Errorf("%w: device_id required", errs.ErrInvalid))
		return
	}
	if h.devices == nil || h.edgeDevices == nil || h.caller == nil {
		writeErr(w, fmt.Errorf("%w: patrol dependencies are not configured", errs.ErrInvalid))
		return
	}
	dev, err := h.devices.Get(r.Context(), req.DeviceID)
	if err != nil {
		writeErr(w, err)
		return
	}
	edgeID, err := h.edgeDevices.LookupEdgeForDevice(r.Context(), req.DeviceID, devicemodel.EdgeDeviceRelationHost)
	if err != nil {
		writeErr(w, fmt.Errorf("resolve device edge: %w", err))
		return
	}
	selectedChecks := selectChecks(req.CheckKeys)
	auditmw.SetAuditEvent(r, bizaudit.Event{
		Action:       auditmodel.ActionSkillExecute,
		ResourceType: auditmodel.ResourceSkill,
		ResourceID:   "security_patrol",
		ResourceName: "安全巡检",
		Payload: map[string]any{
			"device_id": req.DeviceID,
			"edge_id":   edgeID,
			"checks":    auditChecks(selectedChecks),
		},
	})

	checks := make([]checkResult, 0, len(selectedChecks))
	for _, c := range selectedChecks {
		checks = append(checks, h.runCheck(r.Context(), edgeID, c))
	}
	resp := runResp{
		DeviceID:    req.DeviceID,
		DeviceName:  dev.Name,
		Hostname:    dev.Hostname,
		GeneratedAt: time.Now().UTC(),
		Checks:      checks,
	}
	resp.Summary = summarize(checks)
	resp.Markdown = buildMarkdown(resp)
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) runCheck(ctx context.Context, edgeID uint64, c patrolCheck) checkResult {
	res := checkResult{
		Key:      c.key,
		Title:    c.title,
		Severity: c.severity,
		Command:  c.cmd,
		Status:   "unknown",
	}
	body, err := json.Marshal(tunnel.BashExecRequest{Cmd: c.cmd, Timeout: 20})
	if err != nil {
		res.Error = err.Error()
		res.Conclusion = "请求编码失败。"
		return res
	}
	callCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	raw, err := h.caller.Call(callCtx, edgeID, tunnel.MethodBashExec, body)
	if err != nil {
		res.Error = err.Error()
		res.Conclusion = "巡检命令下发失败，请确认 Edge 在线且隧道可用。"
		return res
	}
	var out tunnel.BashExecResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		res.Error = err.Error()
		res.Conclusion = "Edge 返回解析失败。"
		return res
	}
	res.DurationMS = out.DurationMs
	res.Evidence = trimEvidence(firstNonEmpty(out.Stdout, out.Stderr, out.Reason), 1800)
	if !out.Allowed {
		res.Status = "unknown"
		res.Conclusion = "Edge 只读沙箱拒绝该命令，需要使用专门脱敏采集器补齐。"
		if out.Reason != "" {
			res.Error = out.Reason
		}
		return res
	}
	if out.ExitCode != 0 && strings.TrimSpace(out.Stdout) == "" {
		res.Status = "unknown"
		res.Conclusion = "命令返回非零退出码，当前项无法判断。"
		return res
	}
	res.Status, res.Conclusion = c.judge(out)
	return res
}

var defaultChecks = []patrolCheck{
	{
		key: "ssh_root_login", title: "SSH root 登录", severity: "high",
		cmd:   `grep -i PermitRootLogin /etc/ssh/sshd_config`,
		judge: containsBad("permitrootlogin yes", "fail", "配置允许 root 直接 SSH 登录，建议改为 prohibit-password 或 no。", "未发现允许 root 直接登录的显式配置。"),
	},
	{
		key: "ssh_password_auth", title: "密码认证开启", severity: "medium",
		cmd:   `grep -i PasswordAuthentication /etc/ssh/sshd_config`,
		judge: containsBad("passwordauthentication yes", "warn", "SSH 密码认证处于开启状态，建议优先使用密钥或堡垒机策略。", "未发现开启密码认证的显式配置。"),
	},
	{
		key: "login_failed", title: "登录失败", severity: "medium",
		cmd:   `journalctl -u ssh --since=-24h | grep -i failed | head -50`,
		judge: anyOutput("warn", "近 24 小时存在 SSH 登录失败记录，需要关注来源 IP 与频次。", "近 24 小时未采集到 SSH 登录失败记录。"),
	},
	{
		key: "open_ports", title: "开放端口", severity: "medium",
		cmd:   `ss -tulpen`,
		judge: anyOutput("warn", "已采集监听端口清单，请核对是否符合资产暴露面基线。", "未采集到监听端口输出。"),
	},
	{
		key: "firewall_status", title: "防火墙状态", severity: "high",
		cmd:   `iptables -L -n`,
		judge: anyOutput("pass", "已采集 iptables 规则，未见命令异常；请结合策略基线核对默认策略。", "未采集到防火墙规则输出。"),
	},
	{
		key: "sudoers", title: "sudoers", severity: "medium",
		cmd:   `grep -E '^(sudo|wheel):' /etc/group`,
		judge: anyOutput("warn", "已采集 sudo/wheel 组信息；/etc/sudoers 文件受沙箱保护，不直接读取。", "未发现 sudo/wheel 组输出，仍需结合发行版策略确认。"),
	},
	{
		key: "system_accounts", title: "系统账号", severity: "medium",
		cmd:   `awk -F: '$3 < 1000 {print $1":"$3":"$7}' /etc/passwd`,
		judge: anyOutput("pass", "已采集 UID<1000 的系统账号清单，请核对异常 shell 与新增账号。", "未采集到系统账号输出。"),
	},
	{
		key: "critical_processes", title: "关键进程", severity: "medium",
		cmd:   `ps aux --sort=-%cpu | head -20`,
		judge: anyOutput("pass", "已采集 CPU Top 进程，可用于识别异常高占用或缺失关键进程。", "未采集到进程输出。"),
	},
	{
		key: "host_resources", title: "磁盘/CPU/内存", severity: "medium",
		cmd:   `uptime | head -1`,
		judge: anyOutput("pass", "已采集主机负载快照；资产页的 CPU/内存/磁盘百分比可作为补充。", "未采集到资源输出。"),
	},
	{
		key: "recent_changes", title: "最近变更", severity: "medium",
		cmd:   `find /etc -maxdepth 2 -mtime -7 -type f | head -50`,
		judge: anyOutput("warn", "近 7 天存在 /etc 配置文件变更，请核对是否来自计划内操作。", "近 7 天未发现 /etc 下配置文件变更。"),
	},
}

func selectChecks(keys []string) []patrolCheck {
	if len(keys) == 0 {
		return defaultChecks
	}
	want := map[string]bool{}
	for _, key := range keys {
		key = strings.TrimSpace(key)
		if key != "" {
			want[key] = true
		}
	}
	if len(want) == 0 {
		return defaultChecks
	}
	out := make([]patrolCheck, 0, len(defaultChecks))
	for _, c := range defaultChecks {
		if want[c.key] {
			out = append(out, c)
		}
	}
	if len(out) == 0 {
		return defaultChecks
	}
	return out
}

func containsBad(needle, badStatus, badConclusion, okConclusion string) func(tunnel.BashExecResponse) (string, string) {
	return func(out tunnel.BashExecResponse) (string, string) {
		text := strings.ToLower(strings.Join(strings.Fields(out.Stdout), " "))
		if strings.Contains(text, needle) {
			return badStatus, badConclusion
		}
		return "pass", okConclusion
	}
}

func anyOutput(status, hasConclusion, emptyConclusion string) func(tunnel.BashExecResponse) (string, string) {
	return func(out tunnel.BashExecResponse) (string, string) {
		if strings.TrimSpace(out.Stdout) != "" {
			return status, hasConclusion
		}
		return "unknown", emptyConclusion
	}
}

func summarize(items []checkResult) patrolSummary {
	var s patrolSummary
	s.Total = len(items)
	for _, it := range items {
		switch it.Status {
		case "pass":
			s.Pass++
		case "warn":
			s.Warn++
		case "fail":
			s.Fail++
		default:
			s.Unknown++
		}
	}
	return s
}

func auditChecks(checks []patrolCheck) []map[string]string {
	out := make([]map[string]string, 0, len(checks))
	for _, c := range checks {
		out = append(out, map[string]string{
			"key":      c.key,
			"title":    c.title,
			"severity": c.severity,
			"cmd":      c.cmd,
		})
	}
	return out
}

func buildMarkdown(r runResp) string {
	var b strings.Builder
	title := firstNonEmpty(r.DeviceName, r.Hostname, fmt.Sprintf("device-%d", r.DeviceID))
	fmt.Fprintf(&b, "# 安全巡检报告 - %s\n\n", title)
	fmt.Fprintf(&b, "- 设备 ID: %d\n", r.DeviceID)
	if r.Hostname != "" {
		fmt.Fprintf(&b, "- 主机名: %s\n", r.Hostname)
	}
	fmt.Fprintf(&b, "- 生成时间: %s\n", r.GeneratedAt.Format(time.RFC3339))
	fmt.Fprintf(&b, "- 汇总: 通过 %d / 警告 %d / 失败 %d / 未知 %d\n\n", r.Summary.Pass, r.Summary.Warn, r.Summary.Fail, r.Summary.Unknown)
	for _, c := range r.Checks {
		fmt.Fprintf(&b, "## %s [%s]\n\n", c.Title, c.Status)
		fmt.Fprintf(&b, "- 风险等级: %s\n", c.Severity)
		fmt.Fprintf(&b, "- 结论: %s\n", c.Conclusion)
		if c.Command != "" {
			fmt.Fprintf(&b, "- 命令: `%s`\n", c.Command)
		}
		if c.Error != "" {
			fmt.Fprintf(&b, "- 错误: %s\n", c.Error)
		}
		if strings.TrimSpace(c.Evidence) != "" {
			fmt.Fprintf(&b, "\n```text\n%s\n```\n", c.Evidence)
		}
		b.WriteString("\n")
	}
	return b.String()
}

func trimEvidence(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "\n...<truncated>"
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if body != nil {
		_ = json.NewEncoder(w).Encode(body)
	}
}

type errorBody struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

func writeErr(w http.ResponseWriter, err error) {
	status := errs.HTTPStatus(err)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errorBody{Error: err.Error(), Code: errCode(err)})
}

func errCode(err error) string {
	switch {
	case errors.Is(err, errs.ErrUnauthorized):
		return "unauthorized"
	case errors.Is(err, errs.ErrForbidden):
		return "forbidden"
	case errors.Is(err, errs.ErrNotFound):
		return "not-found"
	case errors.Is(err, errs.ErrInvalid):
		return "invalid"
	default:
		return strconv.Itoa(errs.HTTPStatus(err))
	}
}
