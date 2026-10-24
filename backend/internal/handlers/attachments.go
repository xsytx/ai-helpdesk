package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"campus-forum/internal/store"
)

const maxAttachmentBytes = 5 << 20 // 5MB — plenty for a forum image, small enough to not choke local disk storage

// Photos one question / one answer may have.
const (
	maxAttachmentsPerThread = 10
	maxAttachmentsPerAnswer = 4
)

var allowedAttachmentTypes = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

// saveUploadedImage reads one image (multipart field "file", at most
// maxBytes) and writes it to UploadDir/<relDir>/<random>.<ext>. It returns
// the path relative to UploadDir with forward slashes (served at
// /uploads/<path>); on a problem it has written the error and ok is false.
func (h *Handlers) saveUploadedImage(w http.ResponseWriter, r *http.Request, maxBytes int64, relDir string) (relPath, contentType string, size int64, ok bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes+1<<20) // small slack for multipart overhead
	if err := r.ParseMultipartForm(maxBytes + 1<<20); err != nil {
		writeError(w, http.StatusBadRequest, "file too large or invalid upload")
		return "", "", 0, false
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return "", "", 0, false
	}
	defer file.Close()
	if header.Size > maxBytes {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("file must be %dMB or smaller", maxBytes>>20))
		return "", "", 0, false
	}

	// Sniff the real content type rather than trusting the client header.
	sniff := make([]byte, 512)
	n, _ := file.Read(sniff)
	contentType = http.DetectContentType(sniff[:n])
	ext, allowed := allowedAttachmentTypes[contentType]
	if !allowed {
		writeError(w, http.StatusBadRequest, "only PNG, JPEG, GIF, or WEBP images are allowed")
		return "", "", 0, false
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		writeError(w, http.StatusInternalServerError, "could not read upload")
		return "", "", 0, false
	}

	nameBuf := make([]byte, 16)
	if _, err := rand.Read(nameBuf); err != nil {
		writeError(w, http.StatusInternalServerError, "could not generate filename")
		return "", "", 0, false
	}
	diskDir := filepath.Join(h.UploadDir, filepath.FromSlash(relDir))
	if err := os.MkdirAll(diskDir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create upload directory")
		return "", "", 0, false
	}
	name := hex.EncodeToString(nameBuf) + ext
	dst, err := os.Create(filepath.Join(diskDir, name))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save upload")
		return "", "", 0, false
	}
	defer dst.Close()
	size, err = io.Copy(dst, file)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save upload")
		return "", "", 0, false
	}
	return strings.TrimSuffix(relDir, "/") + "/" + name, contentType, size, true
}

// removeUpload deletes a file under UploadDir (best effort: the database
// row is what counts, a leftover file only wastes disk space).
func (h *Handlers) removeUpload(relPath string) {
	if relPath == "" || strings.Contains(relPath, "..") {
		return
	}
	if err := os.Remove(filepath.Join(h.UploadDir, filepath.FromSlash(relPath))); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("delete upload %s: %v", relPath, err)
	}
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
	if existing, err := h.Store.ListAttachments(r.Context(), threadID); err == nil && len(existing) >= maxAttachmentsPerThread {
		writeError(w, http.StatusConflict, fmt.Sprintf("a question can have at most %d photos", maxAttachmentsPerThread))
		return
	}
	h.storeAttachment(w, r, threadID, nil)
}

// UploadAnswerAttachment adds a photo to an answer (its author or a
// moderator), at most maxAttachmentsPerAnswer.
func (h *Handlers) UploadAnswerAttachment(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	commentID, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid comment id")
		return
	}
	c, err := h.Store.GetComment(r.Context(), commentID)
	if err != nil {
		writeStoreErr(w, err, "could not load the answer")
		return
	}
	if c.UserID != uid && !h.isModerator(r, uid) {
		writeError(w, http.StatusForbidden, "you don't own this answer")
		return
	}
	if n, err := h.Store.CountAnswerAttachments(r.Context(), commentID); err == nil && n >= maxAttachmentsPerAnswer {
		writeError(w, http.StatusConflict, fmt.Sprintf("an answer can have at most %d photos", maxAttachmentsPerAnswer))
		return
	}
	h.storeAttachment(w, r, c.ThreadID, &commentID)
}

// storeAttachment saves the uploaded image under the thread's folder and
// records it for the question (commentID nil) or the answer.
func (h *Handlers) storeAttachment(w http.ResponseWriter, r *http.Request, threadID int64, commentID *int64) {
	relPath, contentType, size, ok := h.saveUploadedImage(w, r, maxAttachmentBytes, fmt.Sprintf("%d", threadID))
	if !ok {
		return
	}
	a, err := h.Store.CreateAttachment(r.Context(), threadID, commentID, relPath, contentType, size)
	if err != nil {
		h.removeUpload(relPath)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "thread not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not record attachment")
		return
	}
	writeJSON(w, http.StatusCreated, a)
}

// DeleteAttachment removes a photo (from a question: its author; from an
// answer: the answer's author; or a moderator), with its file.
func (h *Handlers) DeleteAttachment(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := pathInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid attachment id")
		return
	}
	att, err := h.Store.GetAttachment(r.Context(), id)
	if err != nil {
		writeStoreErr(w, err, "could not delete the photo")
		return
	}
	var owner int64
	if att.CommentID != nil {
		c, err := h.Store.GetComment(r.Context(), *att.CommentID)
		if err != nil {
			writeStoreErr(w, err, "could not delete the photo")
			return
		}
		owner = c.UserID
	} else {
		t, err := h.Store.GetThread(r.Context(), att.ThreadID)
		if err != nil {
			writeStoreErr(w, err, "could not delete the photo")
			return
		}
		owner = t.UserID
	}
	if owner != uid && !h.isModerator(r, uid) {
		writeError(w, http.StatusForbidden, "you don't own this post")
		return
	}
	_, path, err := h.Store.DeleteAttachment(r.Context(), id)
	if err != nil {
		writeStoreErr(w, err, "could not delete the photo")
		return
	}
	h.removeUpload(path)
	w.WriteHeader(http.StatusNoContent)
}
