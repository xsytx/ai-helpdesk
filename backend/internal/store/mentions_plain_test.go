package store

import "testing"

func TestPlainMentions(t *testing.T) {
	cases := map[string]string{
		"@[say](u29) from the email confirmation":        "@say from the email confirmation",
		"ask @[Madina Nurlanova](u4) and @[Aruzhan](u2)": "ask @Madina Nurlanova and @Aruzhan",
		"no mentions here, just an @ sign":               "no mentions here, just an @ sign",
		"@[broken](uabc) stays":                          "@[broken](uabc) stays",
	}
	for in, want := range cases {
		if got := PlainMentions(in); got != want {
			t.Errorf("PlainMentions(%q) = %q, want %q", in, got, want)
		}
	}
}
