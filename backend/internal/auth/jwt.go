package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("token expired")
)

type Claims struct {
	UserID int64  `json:"uid"`
	Email  string `json:"email"`
	Exp    int64  `json:"exp"`
	Iat    int64  `json:"iat"`
}

type header struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
}

func b64(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}

func unb64(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

// IssueToken creates a signed HS256 JWT for the given user, valid for ttl.
func IssueToken(secret []byte, userID int64, email string, ttl time.Duration) (string, error) {
	h := header{Alg: "HS256", Typ: "JWT"}
	now := time.Now()
	c := Claims{UserID: userID, Email: email, Iat: now.Unix(), Exp: now.Add(ttl).Unix()}

	hb, err := json.Marshal(h)
	if err != nil {
		return "", err
	}
	cb, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	signingInput := b64(hb) + "." + b64(cb)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signingInput))
	sig := mac.Sum(nil)
	return signingInput + "." + b64(sig), nil
}

// ParseToken verifies signature and expiry, returning the claims.
func ParseToken(secret []byte, token string) (*Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, ErrInvalidToken
	}
	signingInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signingInput))
	expected := mac.Sum(nil)

	got, err := unb64(parts[2])
	if err != nil {
		return nil, ErrInvalidToken
	}
	if !hmac.Equal(expected, got) || subtle.ConstantTimeCompare(expected, got) != 1 {
		return nil, ErrInvalidToken
	}

	cb, err := unb64(parts[1])
	if err != nil {
		return nil, ErrInvalidToken
	}
	var c Claims
	if err := json.Unmarshal(cb, &c); err != nil {
		return nil, ErrInvalidToken
	}
	if time.Now().Unix() > c.Exp {
		return nil, ErrExpiredToken
	}
	return &c, nil
}
