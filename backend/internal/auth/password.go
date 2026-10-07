// Package auth provides password hashing and JWT issuance/verification
// using only the Go standard library (no third-party crypto packages),
// since this environment cannot fetch external modules.
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
)

const (
	pbkdf2Iterations = 100_000
	saltBytes        = 16
	keyBytes         = 32
)

// pbkdf2 implements PBKDF2-HMAC-SHA256 (RFC 8018) using only stdlib primitives.
func pbkdf2(password, salt []byte, iterations, keyLen int) []byte {
	prf := hmac.New(sha256.New, password)
	hashLen := prf.Size()
	numBlocks := (keyLen + hashLen - 1) / hashLen

	var dk []byte
	for block := 1; block <= numBlocks; block++ {
		prf.Reset()
		prf.Write(salt)
		be := []byte{byte(block >> 24), byte(block >> 16), byte(block >> 8), byte(block)}
		prf.Write(be)
		u := prf.Sum(nil)
		t := make([]byte, len(u))
		copy(t, u)
		for i := 1; i < iterations; i++ {
			prf.Reset()
			prf.Write(u)
			u = prf.Sum(nil)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		dk = append(dk, t...)
	}
	return dk[:keyLen]
}

// HashPassword returns (hash, salt) both base64-encoded, suitable for storage.
func HashPassword(password string) (hash string, salt string, err error) {
	saltBuf := make([]byte, saltBytes)
	if _, err := rand.Read(saltBuf); err != nil {
		return "", "", err
	}
	derived := pbkdf2([]byte(password), saltBuf, pbkdf2Iterations, keyBytes)
	return base64.StdEncoding.EncodeToString(derived), base64.StdEncoding.EncodeToString(saltBuf), nil
}

// VerifyPassword checks a plaintext password against a stored hash+salt.
func VerifyPassword(password, hash, salt string) (bool, error) {
	saltBuf, err := base64.StdEncoding.DecodeString(salt)
	if err != nil {
		return false, err
	}
	wantBuf, err := base64.StdEncoding.DecodeString(hash)
	if err != nil {
		return false, err
	}
	got := pbkdf2([]byte(password), saltBuf, pbkdf2Iterations, keyBytes)
	return subtle.ConstantTimeCompare(got, wantBuf) == 1, nil
}

var ErrWeakPassword = errors.New("password must be at least 8 characters")
