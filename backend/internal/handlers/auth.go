package handlers

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"campus-forum/internal/auth"
	"campus-forum/internal/models"
	"campus-forum/internal/store"
)

type registerReq struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

type authResp struct {
	Token string     `json:"token"`
	User  userPublic `json:"user"`
	// DevVerificationCode is only ever set by Register, and only when no
	// SMTP is configured (see sendVerificationEmail) — a local-dev
	// convenience so there's somewhere to read the code from besides the
	// server's stdout. Login never sets it.
	DevVerificationCode string `json:"dev_verification_code,omitempty"`
}

type userPublic struct {
	ID            int64  `json:"id"`
	Email         string `json:"email"`
	DisplayName   string `json:"display_name"`
	Role          string `json:"role"`
	Major         string `json:"major"`
	Bio           string `json:"bio"`
	EmailVerified bool   `json:"email_verified"`
}

func toUserPublic(u models.User) userPublic {
	return userPublic{
		ID: u.ID, Email: u.Email, DisplayName: u.DisplayName, Role: u.Role,
		Major: u.Major, Bio: u.Bio, EmailVerified: u.EmailVerifiedAt != nil,
	}
}

// randomVerificationCode returns a cryptographically random 6-digit code
// as a zero-padded string (e.g. "042917") — short enough to read out of
// an email and type back in. Used for both email verification and
// password resets.
func randomVerificationCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// sendVerificationEmail issues a fresh verification code (replacing any
// still-pending one) and emails it — or, with no SMTP configured, logs
// it (see internal/mailer). Best-effort: a failure here doesn't fail the
// caller's request, and just returns an empty devCode. The code expires
// quickly (unlike a link token, a 6-digit code is guessable, so it
// doesn't get a whole day to be brute forced) and the verify endpoint is
// rate-limited on top of that.
//
// devCode echoes the code back to the caller only when h.Mailer is the
// no-SMTP-configured stub — so Register/ResendVerification can hand it
// straight back in their response for local development, where there's
// otherwise no way to read a "sent" code except the server's stdout.
// With real SMTP configured this is always "": the code only ever
// reaches the actual inbox.
func (h *Handlers) sendVerificationEmail(ctx context.Context, userID int64, email string) (devCode string) {
	code, err := randomVerificationCode()
	if err != nil {
		return ""
	}
	if err := h.Store.CreateEmailVerification(ctx, userID, code, time.Now().Add(15*time.Minute)); err != nil {
		return ""
	}
	_ = h.Mailer.Send(email, "Your SDU Helpdesk verification code",
		fmt.Sprintf("Welcome to SDU Helpdesk! Your verification code is:\n\n%s\n\nEnter it on the site to verify your email. This code expires in 15 minutes.", code))
	if h.Mailer.IsStub() {
		return code
	}
	return ""
}

// isAllowedEmailDomain checks email against h.AllowedEmailDomains
// (case-insensitive); an empty list allows every domain.
func (h *Handlers) isAllowedEmailDomain(email string) bool {
	if len(h.AllowedEmailDomains) == 0 {
		return true
	}
	at := strings.LastIndex(email, "@")
	if at < 0 {
		return false
	}
	domain := strings.ToLower(email[at+1:])
	for _, d := range h.AllowedEmailDomains {
		if domain == d {
			return true
		}
	}
	return false
}

func (h *Handlers) Register(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.DisplayName = strings.TrimSpace(req.DisplayName)

	if _, err := mail.ParseAddress(req.Email); err != nil {
		writeError(w, http.StatusBadRequest, "invalid email address")
		return
	}
	if !h.isAllowedEmailDomain(req.Email) {
		if len(h.AllowedEmailDomains) == 1 {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("email must end with @%s", h.AllowedEmailDomains[0]))
		} else {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("email must be one of: %s", strings.Join(h.AllowedEmailDomains, ", ")))
		}
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	if req.DisplayName == "" {
		writeError(w, http.StatusBadRequest, "display_name is required")
		return
	}

	hash, salt, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not hash password")
		return
	}

	u, err := h.Store.CreateUser(r.Context(), req.Email, req.DisplayName, hash, salt)
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeError(w, http.StatusConflict, "an account with that email already exists")
			return
		}
		if errors.Is(err, store.ErrUsernameTaken) {
			writeError(w, http.StatusConflict, "that display name is already taken")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not create account")
		return
	}
	devCode := h.sendVerificationEmail(r.Context(), u.ID, u.Email)

	token, err := auth.IssueToken(h.JWTSecret, u.ID, u.Email, 7*24*time.Hour)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not issue token")
		return
	}
	writeJSON(w, http.StatusCreated, authResp{Token: token, User: toUserPublic(u), DevVerificationCode: devCode})
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))

	u, err := h.Store.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	ok, err := auth.VerifyPassword(req.Password, u.PasswordHash, u.Salt)
	if err != nil || !ok {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if u.BannedAt != nil {
		writeError(w, http.StatusForbidden, "your account has been suspended")
		return
	}
	token, err := auth.IssueToken(h.JWTSecret, u.ID, u.Email, 7*24*time.Hour)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not issue token")
		return
	}
	writeJSON(w, http.StatusOK, authResp{Token: token, User: toUserPublic(u)})
}

func (h *Handlers) Me(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	u, err := h.Store.GetUserByID(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, toUserPublic(u))
}

// --- Email verification ---

type verifyEmailReq struct {
	Code string `json:"code"`
}

// VerifyEmail checks the code the user typed in against their own
// pending code — authenticated, since a short numeric code (unlike a
// long random link token) isn't unique enough to identify the user on
// its own.
func (h *Handlers) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req verifyEmailReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	code := strings.TrimSpace(req.Code)
	if code == "" {
		writeError(w, http.StatusBadRequest, "code is required")
		return
	}
	if err := h.Store.VerifyEmailCode(r.Context(), uid, code); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusBadRequest, "invalid or expired code")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not verify email")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "verified"})
}

func (h *Handlers) ResendVerification(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	u, err := h.Store.GetUserByID(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	if u.EmailVerifiedAt != nil {
		writeError(w, http.StatusConflict, "email is already verified")
		return
	}
	devCode := h.sendVerificationEmail(r.Context(), u.ID, u.Email)
	resp := map[string]string{"status": "sent"}
	if devCode != "" {
		resp["dev_verification_code"] = devCode
	}
	writeJSON(w, http.StatusOK, resp)
}

// --- Password reset ---

type forgotPasswordReq struct {
	Email string `json:"email"`
}

// ForgotPassword emails a 6-digit reset code. It always responds the same
// way regardless of whether the email is registered, so a request can't be
// used to enumerate accounts — except that with no SMTP configured (local
// dev only) it also returns dev_reset_code for a registered email, the same
// convenience Register offers, since the code is otherwise only in the log.
func (h *Handlers) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req forgotPasswordReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	email := strings.TrimSpace(strings.ToLower(req.Email))
	resp := map[string]string{"status": "if that email is registered, a reset code was sent"}
	if u, err := h.Store.GetUserByEmail(r.Context(), email); err == nil {
		code, cerr := randomVerificationCode()
		if cerr == nil {
			if err := h.Store.CreatePasswordReset(r.Context(), u.ID, code, time.Now().Add(15*time.Minute)); err == nil {
				_ = h.Mailer.Send(email, "Your SDU Helpdesk password reset code",
					fmt.Sprintf("Your password reset code is:\n\n%s\n\nEnter it on the site to set a new password. This code expires in 15 minutes.\n\nIf you didn't ask to reset your password, you can ignore this email.", code))
				if h.Mailer.IsStub() {
					resp["dev_reset_code"] = code
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

type verifyResetCodeReq struct {
	Email string `json:"email"`
	Code  string `json:"code"`
}

// VerifyResetCode checks a reset code without using it up, so the frontend
// can confirm the code before asking for the new password. Wrong guesses
// count toward the code's attempt limit.
func (h *Handlers) VerifyResetCode(w http.ResponseWriter, r *http.Request) {
	var req verifyResetCodeReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	email := strings.TrimSpace(strings.ToLower(req.Email))
	code := strings.TrimSpace(req.Code)
	if email == "" || code == "" {
		writeError(w, http.StatusBadRequest, "email and code are required")
		return
	}
	if err := h.Store.CheckPasswordResetCode(r.Context(), email, code); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusBadRequest, "invalid or expired code")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not check code")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// --- Change password (logged-in user, not the forgot-password flow) ---

type changePasswordReq struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (h *Handlers) ChangePassword(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.userID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var req changePasswordReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.NewPassword) < 8 {
		writeError(w, http.StatusBadRequest, "new password must be at least 8 characters")
		return
	}
	u, err := h.Store.GetUserByID(r.Context(), uid)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	ok, err = auth.VerifyPassword(req.CurrentPassword, u.PasswordHash, u.Salt)
	if err != nil || !ok {
		writeError(w, http.StatusUnauthorized, "current password is incorrect")
		return
	}
	hash, salt, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not hash password")
		return
	}
	if err := h.Store.ChangePassword(r.Context(), uid, hash, salt); err != nil {
		writeStoreErr(w, err, "could not change password")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "password changed"})
}

type resetPasswordReq struct {
	Email       string `json:"email"`
	Code        string `json:"code"`
	NewPassword string `json:"new_password"`
}

func (h *Handlers) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req resetPasswordReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	email := strings.TrimSpace(strings.ToLower(req.Email))
	code := strings.TrimSpace(req.Code)
	if email == "" || code == "" {
		writeError(w, http.StatusBadRequest, "email and code are required")
		return
	}
	if len(req.NewPassword) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	hash, salt, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not hash password")
		return
	}
	if err := h.Store.ResetPassword(r.Context(), email, code, hash, salt); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusBadRequest, "invalid or expired code")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not reset password")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "password reset"})
}
