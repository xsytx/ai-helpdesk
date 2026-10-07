package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"campus-forum/internal/store"
)

const maxAttachmentBytes = 5 << 20 // 5MB — plenty for a forum image, small enough to not choke local disk storage

var allowedAttachmentTypes = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

// UploadAttachment accepts a single image (multipart field "file") and
// attaches it to a thread the caller owns. Files are written to
// UploadDir/<thread_id>/<random>.<ext> and served back out at
// /uploads/<thread_id>/<random>.<ext> (see cmd/server's static handler).
func (h *Handlers) UploadAttachment(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	threadID, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid thread id")
		return
	}
	t, err := h.Store.GetThread(r.Context(), threadID)
	if err != nil {
		writeError(w, http.StatusNotFound, "thread not found")
		return
	}
	if t.UserID != uid && !h.isModerator(r, uid) {
		writeError(w, http.StatusForbidden, "you don't own this thread")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxAttachmentBytes+1<<20) // small slack for multipart overhead
	if err := r.ParseMultipartForm(maxAttachmentBytes + 1<<20); err != nil {
		writeError(w, http.StatusBadRequest, "file too large or invalid upload")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()
	if header.Size > maxAttachmentBytes {
		writeError(w, http.StatusBadRequest, "file must be 5MB or smaller")
		return
	}

	// Sniff the real content type rather than trusting the client header.
	sniff := make([]byte, 512)
	n, _ := file.Read(sniff)
	contentType := http.DetectContentType(sniff[:n])
	ext, ok := allowedAttachmentTypes[contentType]
	if !ok {
		writeError(w, http.StatusBadRequest, "only PNG, JPEG, GIF, or WEBP images are allowed")
		return
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		writeError(w, http.StatusInternalServerError, "could not read upload")
		return
	}

	nameBuf := make([]byte, 16)
	if _, err := rand.Read(nameBuf); err != nil {
		writeError(w, http.StatusInternalServerError, "could not generate filename")
		return
	}
	relDir := fmt.Sprintf("%d", threadID)
	relPath := filepath.Join(relDir, hex.EncodeToString(nameBuf)+ext)

	if err := os.MkdirAll(filepath.Join(h.UploadDir, relDir), 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create upload directory")
		return
	}
	dst, err := os.Create(filepath.Join(h.UploadDir, relPath))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save upload")
		return
	}
	defer dst.Close()
	size, err := io.Copy(dst, file)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save upload")
		return
	}

	// filepath.Join uses OS separators; URLs always want forward slashes.
	urlPath := strings.ReplaceAll(relPath, string(filepath.Separator), "/")
	a, err := h.Store.CreateAttachment(r.Context(), threadID, urlPath, contentType, size)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "thread not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not record attachment")
		return
	}
	writeJSON(w, http.StatusCreated, a)
}
