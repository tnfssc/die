package provider

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
)

const codexClientID = "app_EMoamEEZ73f0CkXaXp7hrann"

type oauthCredential struct {
	Type    string `json:"type"`
	Access  string `json:"access"`
	Refresh string `json:"refresh"`
	Expires int64  `json:"expires"`
}

func codexUserAgent() string {
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x64"
	}
	release, _ := os.ReadFile("/proc/sys/kernel/osrelease")
	if r := strings.TrimSpace(string(release)); r != "" {
		return fmt.Sprintf("pi (%s %s; %s)", runtime.GOOS, r, arch)
	}
	return fmt.Sprintf("pi (%s; %s)", runtime.GOOS, arch)
}

func codexHeaders(token, account, sessionID string) map[string]string {
	h := map[string]string{
		"Authorization":      "Bearer " + token,
		"chatgpt-account-id": account,
		"originator":         "pi",
		"User-Agent":         "pi",
		"OpenAI-Beta":        "responses=experimental",
		"Accept":             "text/event-stream",
	}
	if sessionID != "" {
		h["session-id"], h["x-client-request-id"] = sessionID, sessionID
	}
	return h
}

type codexProvider struct {
	cfg  Config
	mu   sync.Mutex
	cred oauthCredential
}

// ImportCodexAuth explicitly imports only the OpenAI Codex OAuth credential from
// sourceFile into isolated stateDir. It never changes sourceFile.
func ImportCodexAuth(sourceFile, stateDir string) error {
	if sourceFile == "" || stateDir == "" {
		return errors.New("provider: sourceFile and stateDir are required")
	}
	if err := validateIsolatedStateDir(stateDir); err != nil {
		return err
	}
	b, err := os.ReadFile(sourceFile)
	if err != nil {
		return fmt.Errorf("provider: read auth import: %w", err)
	}
	var all map[string]json.RawMessage
	if err = json.Unmarshal(b, &all); err != nil {
		return fmt.Errorf("provider: decode auth import: %w", err)
	}
	raw, ok := all["openai-codex"]
	if !ok {
		return errors.New("provider: source has no openai-codex credential")
	}
	var c oauthCredential
	if err = json.Unmarshal(raw, &c); err != nil || c.Type != "oauth" || c.Access == "" || c.Refresh == "" {
		return errors.New("provider: invalid openai-codex OAuth credential")
	}
	out, err := json.MarshalIndent(map[string]oauthCredential{"openai-codex": c}, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(stateDir, 0700); err != nil {
		return fmt.Errorf("provider: create isolated auth state: %w", err)
	}
	unlock, err := lockAuthState(stateDir)
	if err != nil {
		return err
	}
	defer unlock()
	return atomicPrivateWrite(filepath.Join(stateDir, "auth.json"), append(out, '\n'))
}

func newCodexProvider(cfg Config) (*codexProvider, error) {
	if err := validateIsolatedStateDir(cfg.AuthStateDir); err != nil {
		return nil, err
	}
	if cfg.OAuthBaseURL == "" {
		cfg.OAuthBaseURL = "https://auth.openai.com"
	}
	b, err := os.ReadFile(filepath.Join(cfg.AuthStateDir, "auth.json"))
	if err != nil {
		return nil, fmt.Errorf("provider: read isolated Codex auth: %w", err)
	}
	var all map[string]oauthCredential
	if err = json.Unmarshal(b, &all); err != nil {
		return nil, fmt.Errorf("provider: decode isolated Codex auth: %w", err)
	}
	c := all["openai-codex"]
	if c.Type != "oauth" || c.Access == "" || c.Refresh == "" {
		return nil, errors.New("provider: isolated state has no valid openai-codex OAuth credential")
	}
	return &codexProvider{cfg: cfg, cred: c}, nil
}
func (p *codexProvider) token(ctx context.Context) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.cred.Expires == 0 || time.Now().Add(5*time.Minute).UnixMilli() < p.cred.Expires {
		return p.cred.Access, nil
	}
	// OAuth refresh tokens rotate. Serialize refresh across provider instances and
	// processes sharing this isolated state, then reload in case another process won.
	unlock, err := lockAuthState(p.cfg.AuthStateDir)
	if err != nil {
		return "", err
	}
	defer unlock()
	current, loadErr := readCodexCredential(filepath.Join(p.cfg.AuthStateDir, "auth.json"))
	if loadErr != nil {
		return "", fmt.Errorf("provider: reload isolated Codex auth: %w", loadErr)
	}
	p.cred = current
	if p.cred.Expires == 0 || time.Now().Add(5*time.Minute).UnixMilli() < p.cred.Expires {
		return p.cred.Access, nil
	}
	v := url.Values{"grant_type": {"refresh_token"}, "refresh_token": {p.cred.Refresh}, "client_id": {codexClientID}}
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(p.cfg.OAuthBaseURL, "/")+"/oauth/token", strings.NewReader(v.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := p.cfg.HTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("provider: Codex token refresh: %w", err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("provider: Codex token refresh: %w", safeHTTPError(resp.StatusCode, b))
	}
	var t struct {
		Access    string `json:"access_token"`
		Refresh   string `json:"refresh_token"`
		ExpiresIn int64  `json:"expires_in"`
	}
	if json.Unmarshal(b, &t) != nil || t.Access == "" {
		return "", errors.New("provider: invalid Codex token refresh response")
	}
	p.cred.Access = t.Access
	if t.Refresh != "" {
		p.cred.Refresh = t.Refresh
	}
	p.cred.Expires = time.Now().Add(time.Duration(t.ExpiresIn) * time.Second).UnixMilli()
	out, _ := json.MarshalIndent(map[string]oauthCredential{"openai-codex": p.cred}, "", "  ")
	if err = atomicPrivateWrite(filepath.Join(p.cfg.AuthStateDir, "auth.json"), append(out, '\n')); err != nil {
		return "", err
	}
	return p.cred.Access, nil
}
func atomicPrivateWrite(path string, b []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0600); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}
func jwtAccountID(token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return "", errors.New("provider: invalid Codex access token")
	}
	b, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", errors.New("provider: invalid Codex access token")
	}
	var claims map[string]any
	if json.Unmarshal(b, &claims) != nil {
		return "", errors.New("provider: invalid Codex access token")
	}
	v, _ := claims["https://api.openai.com/auth"].(map[string]any)
	id, _ := v["chatgpt_account_id"].(string)
	if id == "" {
		return "", errors.New("provider: Codex token has no account ID")
	}
	return id, nil
}
func validateIsolatedStateDir(dir string) error {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return fmt.Errorf("provider: invalid isolated auth state: %w", err)
	}
	home, err := os.UserHomeDir()
	if err == nil {
		forbidden := filepath.Join(home, ".die")
		rel, relErr := filepath.Rel(forbidden, abs)
		if relErr == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return errors.New("provider: AuthStateDir must not be ~/.die")
		}
	}
	if info, statErr := os.Lstat(abs); statErr == nil && info.Mode()&os.ModeSymlink != 0 {
		return errors.New("provider: AuthStateDir must not be a symlink")
	}
	return nil
}

func readCodexCredential(path string) (oauthCredential, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return oauthCredential{}, err
	}
	var all map[string]oauthCredential
	if err := json.Unmarshal(b, &all); err != nil {
		return oauthCredential{}, err
	}
	c := all["openai-codex"]
	if c.Type != "oauth" || c.Access == "" || c.Refresh == "" {
		return oauthCredential{}, errors.New("invalid Codex credential")
	}
	return c, nil
}

func lockAuthState(dir string) (func(), error) {
	f, err := os.OpenFile(filepath.Join(dir, ".auth.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, fmt.Errorf("provider: open isolated auth lock: %w", err)
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		f.Close()
		return nil, fmt.Errorf("provider: lock isolated auth state: %w", err)
	}
	return func() { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN); _ = f.Close() }, nil
}
