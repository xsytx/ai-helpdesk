// Package markdown renders user-submitted thread/comment bodies to safe
// HTML. goldmark escapes any raw HTML in the source by default (no
// WithUnsafe option is set), so the output is safe to insert as innerHTML
// on the frontend without a separate sanitization pass.
package markdown

import (
	"bytes"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
)

var renderer = goldmark.New(goldmark.WithExtensions(extension.GFM))

// Render converts Markdown source to an HTML fragment. On a parse error
// (rare — goldmark is quite permissive) it falls back to empty, so
// callers should treat an empty result as "no rendering available" rather
// than blocking on it.
func Render(source string) string {
	var buf bytes.Buffer
	if err := renderer.Convert([]byte(source), &buf); err != nil {
		return ""
	}
	return buf.String()
}
