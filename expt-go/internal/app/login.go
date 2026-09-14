package app

import (
	"context"
	"errors"
	"fmt"
	"godie/internal/provider"
	"net"
	"net/http"
	"time"
)

// LoginCodex starts only on explicit user action. Auth codes/tokens never enter
// diagnostics, sessions, callback URL output, or logs.
func LoginCodex(ctx context.Context, stateDir string, notify func(string)) error {
	flow, err := provider.BeginCodexBrowserLogin("")
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:1455")
	if err != nil {
		return fmt.Errorf("Codex callback port unavailable: %w; use explicit auth import instead", err)
	}
	defer listener.Close()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	result := make(chan error, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/auth/callback", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Query().Get("state") != flow.State {
			http.Error(w, "Invalid login callback", http.StatusBadRequest)
			return
		}
		err := flow.Complete(ctx, "http://localhost:1455"+r.URL.RequestURI(), stateDir, nil)
		if err != nil {
			http.Error(w, "Login failed; return to terminal", http.StatusBadRequest)
		} else {
			fmt.Fprintln(w, "Login complete. Return to die.")
		}
		select {
		case result <- err:
		default:
		}
	})
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second}
	defer server.Close()
	go func() {
		err := server.Serve(listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			select {
			case result <- err:
			default:
			}
		}
	}()
	if notify != nil {
		notify("Open this URL in your browser to sign in with ChatGPT (five-minute timeout):\n" + flow.AuthorizationURL)
	}
	select {
	case err := <-result:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}
