package provider

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const codexRedirectURI = "http://localhost:1455/auth/callback"

// CodexBrowserLogin is a bounded, manual PKCE flow. Begin does not open a
// browser or listener. The coordinator presents AuthorizationURL and passes the
// resulting redirect URL to Complete under a caller-owned context deadline.
type CodexBrowserLogin struct {
	AuthorizationURL string
	State            string
	verifier         string
	oauthBaseURL     string
	mu               sync.Mutex
	used             bool
}

func randomURLToken(bytes int) (string, error) {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// BeginCodexBrowserLogin reproduces Pi's Codex browser authorization request
// without initiating login or making a network request. oauthBaseURL is empty
// for OpenAI; a non-empty value exists for fixture/private-authority testing.
func BeginCodexBrowserLogin(oauthBaseURL string) (*CodexBrowserLogin, error) {
	if oauthBaseURL == "" {
		oauthBaseURL = "https://auth.openai.com"
	}
	base, err := url.Parse(strings.TrimRight(oauthBaseURL, "/") + "/oauth/authorize")
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil, errors.New("provider: invalid Codex OAuth base URL")
	}
	verifier, err := randomURLToken(32)
	if err != nil {
		return nil, fmt.Errorf("provider: create PKCE verifier: %w", err)
	}
	state, err := randomURLToken(16)
	if err != nil {
		return nil, fmt.Errorf("provider: create OAuth state: %w", err)
	}
	digest := sha256.Sum256([]byte(verifier))
	q := base.Query()
	q.Set("response_type", "code")
	q.Set("client_id", codexClientID)
	q.Set("redirect_uri", codexRedirectURI)
	q.Set("scope", "openid profile email offline_access")
	q.Set("code_challenge", base64.RawURLEncoding.EncodeToString(digest[:]))
	q.Set("code_challenge_method", "S256")
	q.Set("state", state)
	q.Set("id_token_add_organizations", "true")
	q.Set("codex_cli_simplified_flow", "true")
	q.Set("originator", "pi")
	base.RawQuery = q.Encode()
	return &CodexBrowserLogin{AuthorizationURL: base.String(), State: state, verifier: verifier, oauthBaseURL: oauthBaseURL}, nil
}

func (flow *CodexBrowserLogin) Complete(ctx context.Context, callbackURL, stateDir string, client *http.Client) error {
	if flow == nil {
		return errors.New("provider: nil Codex browser login")
	}
	if err := validateIsolatedStateDir(stateDir); err != nil {
		return err
	}
	callback, err := url.Parse(strings.TrimSpace(callbackURL))
	if err != nil || callback.Scheme != "http" || callback.Host != "localhost:1455" || callback.Path != "/auth/callback" {
		return errors.New("provider: invalid Codex OAuth callback URL")
	}
	if callback.Query().Get("state") != flow.State {
		return errors.New("provider: Codex OAuth state mismatch")
	}
	code := callback.Query().Get("code")
	if code == "" {
		return errors.New("provider: Codex OAuth callback has no code")
	}
	flow.mu.Lock()
	if flow.used {
		flow.mu.Unlock()
		return errors.New("provider: Codex browser login was already completed")
	}
	flow.used = true
	flow.mu.Unlock()
	if client == nil {
		client = http.DefaultClient
	}
	values := url.Values{"grant_type": {"authorization_code"}, "client_id": {codexClientID}, "code": {code}, "code_verifier": {flow.verifier}, "redirect_uri": {codexRedirectURI}}
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(flow.oauthBaseURL, "/")+"/oauth/token", strings.NewReader(values.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("provider: Codex token exchange: %w", err)
	}
	defer resp.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if readErr != nil {
		return fmt.Errorf("provider: read Codex token exchange: %w", readErr)
	}
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("provider: Codex token exchange status %d", resp.StatusCode)
	}
	var token struct {
		Access    string `json:"access_token"`
		Refresh   string `json:"refresh_token"`
		ExpiresIn int64  `json:"expires_in"`
	}
	if json.Unmarshal(body, &token) != nil || token.Access == "" || token.Refresh == "" || token.ExpiresIn <= 0 {
		return errors.New("provider: invalid Codex token exchange response")
	}
	credential := oauthCredential{Type: "oauth", Access: token.Access, Refresh: token.Refresh, Expires: time.Now().Add(time.Duration(token.ExpiresIn) * time.Second).UnixMilli()}
	encoded, _ := json.MarshalIndent(map[string]oauthCredential{"openai-codex": credential}, "", "  ")
	if err := os.MkdirAll(stateDir, 0700); err != nil {
		return fmt.Errorf("provider: create isolated auth state: %w", err)
	}
	return atomicPrivateWrite(filepath.Join(stateDir, "auth.json"), append(encoded, '\n'))
}
