package handlers

import (
	"html/template"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"campus-forum/internal/curricula"
	"campus-forum/internal/store"
)

// Link previews. Telegram, WhatsApp and other apps read a page's
// <meta property="og:…"> tags to show a card when a link is pasted, but
// they don't run JavaScript, so the React app's index.html shows them
// nothing. nginx sends those apps (by User-Agent) to GET /api/preview/<page
// path>, which answers with a small page carrying the tags.
//
// Only what anyone could already read is shown: published questions
// (moderation status "ok"), shared chats, a profile's name, a course's
// portal data. Anything else gets the site's own card.

const (
	previewSite  = "SDU Helpdesk"
	previewImage = "/og-image.png"
	previewDesc  = "AI assistant, forum, campus map and courses for SDU students · Помощь студентам SDU · SDU студенттеріне көмек"
)

type previewPage struct {
	Title       string
	Description string
	URL         string
	Image       string
	Type        string
}

var previewTmpl = template.Must(template.New("preview").Parse(`<!doctype html>
<html><head>
<meta charset="utf-8">
<title>{{.Title}}</title>
<meta name="description" content="{{.Description}}">
<meta property="og:site_name" content="SDU Helpdesk">
<meta property="og:type" content="{{.Type}}">
<meta property="og:title" content="{{.Title}}">
<meta property="og:description" content="{{.Description}}">
<meta property="og:url" content="{{.URL}}">
<meta property="og:image" content="{{.Image}}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{{.Title}}">
<meta name="twitter:description" content="{{.Description}}">
<meta name="twitter:image" content="{{.Image}}">
</head><body>
<h1>{{.Title}}</h1>
<p>{{.Description}}</p>
<p><a href="{{.URL}}">{{.URL}}</a></p>
</body></html>
`))

// LinkPreview: GET /api/preview/{path...} — the card for /<path>.
func (h *Handlers) LinkPreview(w http.ResponseWriter, r *http.Request) {
	path := "/" + strings.Trim(r.PathValue("path"), "/")
	p := h.previewFor(r, path)
	p.URL = h.BaseURL + path
	if p.Image == "" {
		p.Image = previewImage
	}
	if strings.HasPrefix(p.Image, "/") {
		p.Image = h.BaseURL + p.Image
	}
	if p.Type == "" {
		p.Type = "website"
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=600")
	_ = previewTmpl.Execute(w, p)
}

func (h *Handlers) previewFor(r *http.Request, path string) previewPage {
	ctx := r.Context()
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	site := previewPage{Title: previewSite, Description: previewDesc}
	section := func(name string) previewPage {
		return previewPage{Title: name + " · " + previewSite, Description: previewDesc}
	}
	switch parts[0] {
	case "forum":
		if len(parts) < 2 {
			return section("Forum")
		}
		id, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil {
			return section("Forum")
		}
		t, err := h.Store.GetThread(ctx, id)
		// "checking" posts are shown on the site, but a preview is kept by
		// the app that fetched it: only posts that passed moderation.
		if err != nil || (t.ModerationStatus != "ok" && t.ModerationStatus != "") {
			return section("Forum")
		}
		p := previewPage{Title: clip(t.Title, 120), Description: clip(store.PlainMentions(t.Body), 220), Type: "article"}
		if p.Description == "" {
			p.Description = previewDesc
		}
		for _, a := range t.Attachments {
			if a.CommentID == nil {
				p.Image = a.URL
				break
			}
		}
		return p
	case "shared":
		if len(parts) < 2 || parts[1] == "" || len(parts[1]) > 64 {
			return site
		}
		conv, msgs, err := h.Store.SharedChat(ctx, parts[1])
		if err != nil {
			return site
		}
		p := previewPage{Title: clip(conv.Title, 120) + " · " + previewSite, Description: previewDesc, Type: "article"}
		for _, m := range msgs {
			if m.Role == "assistant" && strings.TrimSpace(m.Text) != "" {
				p.Description = clip(store.PlainMentions(m.Text), 220)
				break
			}
		}
		return p
	case "users":
		if len(parts) < 2 {
			return site
		}
		id, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil {
			return site
		}
		u, err := h.Store.GetUserByID(ctx, id)
		if err != nil {
			return site
		}
		return previewPage{Title: clip(u.DisplayName, 80) + " · " + previewSite, Description: previewDesc, Type: "profile"}
	case "courses":
		if len(parts) < 2 {
			return section("Courses")
		}
		code, ok := curricula.NormalizeCode(strings.ReplaceAll(parts[1], "-", " "))
		if !ok {
			return section("Courses")
		}
		c, err := h.Store.GetCourse(ctx, code)
		if err != nil {
			return section("Courses")
		}
		desc := strconv.Itoa(c.ECTS) + " ECTS"
		if d := strings.TrimSpace(c.Description); d != "" {
			desc += " · " + d
		}
		return previewPage{Title: c.Code + " " + c.Name + " · " + previewSite, Description: clip(desc, 220)}
	case "chat":
		return section("AI assistant")
	case "navigation", "maps":
		return section("Campus map")
	case "faq":
		return section("FAQ")
	}
	return site
}

// clip collapses whitespace and cuts s to max letters, ending with "…".
func clip(s string, max int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	return strings.TrimSpace(string(runes[:max-1])) + "…"
}
