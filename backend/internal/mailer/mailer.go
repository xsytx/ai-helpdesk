// Package mailer sends transactional email (verification links, password
// resets, subscription notifications). With no SMTP_* environment
// variables set, it logs what would have been sent instead of actually
// sending anything — a safe default for local development that keeps
// every email-triggering flow fully testable without a real mail
// provider. Set SMTP_HOST (and friends) to send for real; nothing else
// in the codebase needs to change.
package mailer

import (
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"net/mail"
	"net/smtp"
	"os"
	"time"
)

type Mailer interface {
	Send(to, subject, body string) error
	// IsStub reports whether this Mailer actually delivers mail or just
	// logs it (no SMTP_HOST configured). Handlers use it to decide
	// whether it's safe/useful to also hand a code straight back in an
	// API response — see Register/ResendVerification — since otherwise a
	// developer with no SMTP set up would have nowhere to read a
	// verification code from except the server's stdout.
	IsStub() bool
}

// New returns an SMTP-backed Mailer if SMTP_HOST is set, otherwise a
// logging stub.
func New() Mailer {
	host := os.Getenv("SMTP_HOST")
	if host == "" {
		return logMailer{}
	}
	from := os.Getenv("SMTP_FROM")
	if from == "" {
		from = os.Getenv("SMTP_USER")
	}
	return &smtpMailer{
		host: host,
		port: getenvDefault("SMTP_PORT", "587"),
		user: os.Getenv("SMTP_USER"),
		pass: os.Getenv("SMTP_PASS"),
		from: from,
	}
}

func getenvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

type logMailer struct{}

func (logMailer) Send(to, subject, body string) error {
	log.Printf("[mailer stub — no SMTP_HOST configured] to=%s subject=%q\n%s", to, subject, body)
	return nil
}

func (logMailer) IsStub() bool { return true }

type smtpMailer struct {
	host, port, user, pass, from string
}

// sendTimeout bounds one email from connecting to the last byte, so a slow
// or unreachable mail server can't keep a sender waiting forever.
const sendTimeout = 30 * time.Second

func (m *smtpMailer) Send(to, subject, body string) error {
	// SMTP_FROM may include a display name ("SDU Helpdesk <x@y.z>"); the
	// envelope sender has to be the bare address.
	envelopeFrom := m.from
	if addr, err := mail.ParseAddress(m.from); err == nil {
		envelopeFrom = addr.Address
	}
	// Date and MIME-Version keep strict providers (Gmail) from flagging the mail.
	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s",
		m.from, to, subject, time.Now().Format(time.RFC1123Z), body)

	// Like smtp.SendMail (STARTTLS when offered, then auth), but with a deadline.
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(m.host, m.port), 10*time.Second)
	if err != nil {
		return err
	}
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(sendTimeout)); err != nil {
		return err
	}
	c, err := smtp.NewClient(conn, m.host)
	if err != nil {
		return err
	}
	defer c.Close()
	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(&tls.Config{ServerName: m.host}); err != nil {
			return err
		}
	}
	if m.user != "" {
		if err := c.Auth(smtp.PlainAuth("", m.user, m.pass, m.host)); err != nil {
			return err
		}
	}
	if err := c.Mail(envelopeFrom); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	wc, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := wc.Write([]byte(msg)); err != nil {
		return err
	}
	if err := wc.Close(); err != nil {
		return err
	}
	return c.Quit()
}

func (*smtpMailer) IsStub() bool { return false }
