package app

import (
	"encoding/base64"
	"fmt"
	"godie/internal/core"
)

// maxCLIAttachmentBytes bounds bytes retained in both options and the session.
// Base64 expansion then remains below the session's 4 MiB entry bound.
const maxCLIAttachmentBytes = 3_000_000

func imageMIME(data []byte) string {
	switch {
	case len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n":
		return "image/png"
	case len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		return "image/jpeg"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "image/webp"
	default:
		return ""
	}
}

func cliImage(data []byte, path string) (core.Image, bool, error) {
	mime := imageMIME(data)
	if mime == "" {
		return core.Image{}, false, nil
	}
	if len(data) > maxCLIAttachmentBytes {
		return core.Image{}, true, fmt.Errorf("image @file attachment exceeds %d bytes: %s", maxCLIAttachmentBytes, path)
	}
	return core.Image{MIME: mime, Data: base64.StdEncoding.EncodeToString(data)}, true, nil
}
