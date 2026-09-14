package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"godie/internal/core"
	"godie/internal/session"
	"io"
)

var onePixelPNG, _ = base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")

func TestPrepareCLIOptionsImageAndTextAttachments(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "pixel.png"), onePixelPNG, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "note.txt"), []byte("\xef\xbb\xbfnotes"), 0600); err != nil {
		t.Fatal(err)
	}
	o, err := PrepareCLIOptions(Options{CWD: dir, StateDir: t.TempDir(), FileArgs: []string{"pixel.png", "note.txt"}, Messages: []string{"question"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(o.Images) != 1 || o.Images[0].MIME != "image/png" || o.Images[0].Data != base64.StdEncoding.EncodeToString(onePixelPNG) {
		t.Fatalf("images=%#v", o.Images)
	}
	if len(o.Messages) != 1 || !strings.Contains(o.Messages[0], "notes\n</file>\nquestion") {
		t.Fatalf("messages=%q", o.Messages)
	}
}

func TestCLIImagesAreBoundedAndBinaryStillRejected(t *testing.T) {
	dir := t.TempDir()
	large := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, maxCLIAttachmentBytes)...)
	if err := os.WriteFile(filepath.Join(dir, "large.png"), large, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareCLIOptions(Options{CWD: dir, StateDir: t.TempDir(), FileArgs: []string{"large.png"}}); err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("large image error=%v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "blob.bin"), []byte{1, 0, 2}, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareCLIOptions(Options{CWD: dir, StateDir: t.TempDir(), FileArgs: []string{"blob.bin"}}); err == nil || !strings.Contains(err.Error(), "binary @file") {
		t.Fatalf("binary error=%v", err)
	}
	for _, tc := range []struct {
		data []byte
		mime string
	}{{[]byte{0xff, 0xd8, 0xff, 0xd9}, "image/jpeg"}, {[]byte("RIFFxxxxWEBPVP8 "), "image/webp"}} {
		if im, ok, err := cliImage(tc.data, "x"); err != nil || !ok || im.MIME != tc.mime {
			t.Fatalf("%s: %#v %v %v", tc.mime, im, ok, err)
		}
	}
}

func TestCLIImageLoopbackRequestAndPersistedSession(t *testing.T) {
	var requestBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var err error
		requestBody, err = io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"r1\",\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"seen\"}]}],\"usage\":{}}}\n\n")
	}))
	defer srv.Close()
	dir, state := t.TempDir(), t.TempDir()
	imagePath := filepath.Join(dir, "pixel.png")
	if err := os.WriteFile(imagePath, onePixelPNG, 0600); err != nil {
		t.Fatal(err)
	}
	o, err := ParseOptions([]string{"--provider", "openai", "--model", "test", "--api-key", "test", "--base-url", srv.URL, "--state-dir", state, "--session-id", "cli-image", "--no-context-files", "@" + imagePath, "describe"})
	if err != nil {
		t.Fatal(err)
	}
	o.CWD = dir
	o, err = PrepareCLIOptions(o)
	if err != nil {
		t.Fatal(err)
	}
	a, err := NewApplication(o)
	if err != nil {
		t.Fatal(err)
	}
	if err = a.Submit(context.Background(), strings.Join(o.Messages, " "), nil); err != nil {
		a.Close()
		t.Fatal(err)
	}
	sessionFile := a.Session.File()
	if err = a.Close(); err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err = json.Unmarshal(requestBody, &body); err != nil {
		t.Fatalf("request: %v: %s", err, requestBody)
	}
	if !strings.Contains(string(requestBody), "data:image/png;base64,"+base64.StdEncoding.EncodeToString(onePixelPNG)) {
		t.Fatalf("provider request has no image: %s", requestBody)
	}
	r, err := session.OpenReadOnly(sessionFile)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := r.Branch()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) < 2 || entries[0].Message == nil || entries[0].Message.Role != "user" || len(entries[0].Message.Images) != 1 || entries[0].Message.Images[0].Data != base64.StdEncoding.EncodeToString(onePixelPNG) {
		t.Fatalf("persisted entries=%#v", entries)
	}
}

func TestInitialImagesWaitForFirstVisiblePromptAndAreOneShot(t *testing.T) {
	j := &memJournal{}
	e := &Engine{Provider: &fakeProvider{}, Executor: &fakeExecutor{}, Journal: j, InitialImages: []core.Image{{MIME: "image/png", Data: "abc"}}}
	if err := e.TurnHidden(context.Background(), "background", nil); err != nil {
		t.Fatal(err)
	}
	if err := e.Turn(context.Background(), "first", nil); err != nil {
		t.Fatal(err)
	}
	if err := e.Turn(context.Background(), "later", nil); err != nil {
		t.Fatal(err)
	}
	if len(j.messages) != 6 || len(j.messages[0].Images) != 0 || len(j.messages[2].Images) != 1 || len(j.messages[4].Images) != 0 {
		t.Fatalf("messages=%#v", j.messages)
	}
}
