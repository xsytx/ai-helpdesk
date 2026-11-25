package curricula

import (
	"errors"
	"os"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

// The Mathematics curriculum as copied from the portal (Ctrl+A, Ctrl+C), with
// the elective lists shortened.
func loadSample(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("testdata/mathematics_10101_2026.txt")
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestParsePortalCurriculum(t *testing.T) {
	c, err := Parse(loadSample(t))
	if err != nil {
		t.Fatal(err)
	}
	if c.Year != 2026 || c.ProgramCode != "10101" || c.Title != "Mathematics" || c.Lang != "EN" || c.Track != "Main Track" || c.Level != "B" {
		t.Fatalf("header: %+v", c)
	}
	if len(c.Semesters) != 8 {
		t.Fatalf("semesters: %d", len(c.Semesters))
	}
	for i, s := range c.Semesters {
		if s.Number != i+1 {
			t.Fatalf("semester %d numbered %d", i+1, s.Number)
		}
	}
	if len(c.Warnings) != 0 {
		t.Fatalf("warnings: %q", c.Warnings)
	}

	// Semester 1: six fixed courses and the foreign-language slot.
	s1 := c.Semesters[0].Items
	if len(s1) != 7 {
		t.Fatalf("semester 1 items: %d", len(s1))
	}
	if got := *s1[0].Course; got != (Course{Code: "MAT 101", Name: "Mathematical analysis 1", Theory: 2, Practice: "2+0", Hours: 4, ECTS: 5}) {
		t.Fatalf("first course: %+v", got)
	}
	slot := s1[6].Slot
	if slot == nil || slot.Kind != "NAE" || slot.Label != "Foreign language 1" || !reflect.DeepEqual(slot.Options, []string{"MDE 190", "MDE 192"}) || slot.ECTS != 5 {
		t.Fatalf("language slot: %+v", s1[6])
	}

	// Starred rows ("2*") are kept as marked.
	s3 := c.Semesters[2].Items
	if s3[0].Marked || !s3[1].Marked || s3[1].Course.Code != "MAT 124" {
		t.Fatalf("marks: %+v %+v", s3[0], s3[1])
	}

	// Lower-case placeholders, slashes between options, a label with a slash in it.
	s6 := c.Semesters[5].Items
	if s6[4].Slot == nil || s6[4].Slot.Label != "Elective 3" || !reflect.DeepEqual(s6[4].Slot.Options, []string{"MAT 315", "MAT 434", "MAT 146"}) {
		t.Fatalf("lower-case placeholder: %+v", s6[4])
	}
	s7 := c.Semesters[6].Items
	if !reflect.DeepEqual(s7[4].Slot.Options, []string{"MAT 470", "MAT 474", "MAT 450"}) {
		t.Fatalf("slash options: %+v", s7[4].Slot)
	}
	s8 := c.Semesters[7].Items
	if s8[2].Slot == nil || s8[2].Slot.Kind != "NTE" || s8[2].Slot.Label != "Thesis defense /Project defense" ||
		!reflect.DeepEqual(s8[2].Slot.Options, []string{"MAT 402", "MAT 439"}) || s8[2].Slot.ECTS != 12 {
		t.Fatalf("thesis slot: %+v", s8[2].Slot)
	}
	s3slot := c.Semesters[2].Items[6].Slot
	if s3slot.Label != "Kazakh / Russian language 1" || len(s3slot.Options) != 11 {
		t.Fatalf("language slot with a slash in its label: %+v", s3slot)
	}

	// ECTS add up to the portal's total.
	total := 0
	for _, s := range c.Semesters {
		for _, it := range s.Items {
			if it.Course != nil {
				total += it.Course.ECTS
			} else {
				total += it.Slot.ECTS
			}
		}
	}
	if total != 240 {
		t.Fatalf("total ECTS %d, want 240", total)
	}

	// The elective lists, with Cyrillic look-alike letters cleaned.
	if len(c.Electives["AE"]) != 9 || len(c.Electives["NAE"]) != 4 || len(c.Electives["NTE"]) != 2 || len(c.Electives["RC"]) != 1 {
		t.Fatalf("elective lists: %d AE, %d NAE, %d NTE, %d RC", len(c.Electives["AE"]), len(c.Electives["NAE"]), len(c.Electives["NTE"]), len(c.Electives["RC"]))
	}
	names := map[string]string{}
	for _, list := range c.Electives {
		for _, e := range list {
			names[e.Code] = e.Name
		}
	}
	if names["MDE 161"] != "Economy" || names["MDE 166"] != "Entrepreneurship" || names["MDE 021"] != "Russian Language 1 (A2 level)" {
		t.Fatalf("look-alike letters: %q %q %q", names["MDE 161"], names["MDE 166"], names["MDE 021"])
	}
	if names["CSS 324"] != "Introduction to Machine Learning" {
		t.Fatalf("elective name: %q", names["CSS 324"])
	}
}

func TestParseWithSpacesInsteadOfTabs(t *testing.T) {
	// Some browsers copy table cells with spaces: the same result.
	tabs, err := Parse(loadSample(t))
	if err != nil {
		t.Fatal(err)
	}
	spaces, err := Parse(strings.ReplaceAll(loadSample(t), "\t", "  "))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(tabs, spaces) {
		t.Fatal("tabs and spaces give different results")
	}
}

func TestParseRejectsOtherText(t *testing.T) {
	for _, text := range []string{"", "hello", "2026-10101 Mathematics (EN)\nMain Track\nBachelor\n", strings.Repeat("x", MaxText+1)} {
		if _, err := Parse(text); err == nil {
			t.Fatalf("no error for %.40q", text)
		}
	}
}

func TestRealCourseWithXInPrefix(t *testing.T) {
	text := "2026-10101 Mathematics (EN)\nMain Track\nBachelor\n1\n1\tEXT 101\tExtension course\t\t2\t1+0\t3\t5\n"
	c, err := Parse(text)
	if err != nil {
		t.Fatal(err)
	}
	if it := c.Semesters[0].Items[0]; it.Course == nil || it.Course.Code != "EXT 101" {
		t.Fatalf("EXT 101 is a course, not a placeholder: %+v", it)
	}
}

func TestCleanTextAndCodes(t *testing.T) {
	cases := map[string]string{
		"Еconomy":             "Economy",
		"(А2 level)":          "(A2 level)",
		"Қазақ тілі":          "Қазақ тілі",
		"Мама":                "Мама",
		"  Linear   Algebra ": "Linear Algebra",
	}
	for in, want := range cases {
		if got := CleanText(in); got != want {
			t.Fatalf("CleanText(%q) = %q, want %q", in, got, want)
		}
	}
	for in, want := range map[string]string{"mat127": "MAT 127", " CSS 324 ": "CSS 324"} {
		if got, ok := NormalizeCode(in); !ok || got != want {
			t.Fatalf("NormalizeCode(%q) = %q %v", in, got, ok)
		}
	}
	if _, ok := NormalizeCode("XXX 1XX"); ok {
		t.Fatal("a placeholder is not a course code")
	}
}

func TestSplitRowsAreJoined(t *testing.T) {
	// A name wrapped onto the next line, and the last cells on lines of their own.
	c, err := Parse("2026-10101 Mathematics (EN)\nMain Track\nBachelor\n1\n1\tMAT 101\tMathematical\nanalysis 1\t\t2\t2+0\t4\t5\n2\tMAT 123\tLinear Algebra\t\t2\n2+0\n4\n5\n3\tMAT 125\tDiscrete mathematics\t\t2\t2+0\t4\t5\nTotal ects: 15\nTOTAL ECTS: 15\n")
	if err != nil {
		t.Fatal(err)
	}
	items := c.Semesters[0].Items
	if len(items) != 3 || len(c.Warnings) != 0 {
		t.Fatalf("items %d, warnings %q", len(items), c.Warnings)
	}
	if items[0].Course.Name != "Mathematical analysis 1" || items[1].Course.Code != "MAT 123" || items[1].Course.ECTS != 5 {
		t.Fatalf("joined rows: %+v %+v", items[0].Course, items[1].Course)
	}
	if c.ImportProblem() != "" {
		t.Fatalf("import problem: %s", c.ImportProblem())
	}
}

func TestBrokenPagesCannotBeImported(t *testing.T) {
	// A row that never completes: a warning, and the import is refused.
	c, err := Parse("2026-10101 Mathematics (EN)\nMain Track\nBachelor\n1\n1\tMAT 101\tMathematical analysis 1\t\t2\t2+0\n2\n1\tMAT 106\tICT\t\t1\t2+0\t3\t5\n")
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Warnings) != 1 || c.ImportProblem() != "unreadable_rows" {
		t.Fatalf("warnings %q, problem %q", c.Warnings, c.ImportProblem())
	}
	// A semester with no rows.
	c, err = Parse("2026-10101 Mathematics (EN)\nMain Track\nBachelor\n1\n2\n1\tMAT 106\tICT\t\t1\t2+0\t3\t5\n")
	if err != nil {
		t.Fatal(err)
	}
	if c.ImportProblem() != "empty_semester" {
		t.Fatalf("problem %q", c.ImportProblem())
	}
	// Two pages pasted together.
	two := loadSample(t) + "\n" + loadSample(t)
	var pe *ParseError
	if _, err := Parse(two); !errors.As(err, &pe) || pe.Code != "two_curricula" {
		t.Fatalf("two pages: %v", err)
	}
}

// A saved page (Ctrl+S) of another program, as the admin panel reads it:
// starred rows written "2 *", placeholders with four characters ("MDE 1XXX").
func TestSavedPageOfAnotherProgram(t *testing.T) {
	b, err := os.ReadFile("testdata/applied_math_10132_2026_saved_page.txt")
	if err != nil {
		t.Fatal(err)
	}
	c, err := Parse(string(b))
	if err != nil {
		t.Fatal(err)
	}
	if c.ProgramCode != "10132" || c.ExpectedECTS != 240 || len(c.Warnings) != 0 || c.ImportProblem() != "" {
		t.Fatalf("program %s, expected %d, warnings %q, problem %q", c.ProgramCode, c.ExpectedECTS, c.Warnings, c.ImportProblem())
	}
	total := 0
	for _, s := range c.Semesters {
		if s.ExpectedECTS == 0 || s.ECTS() != s.ExpectedECTS {
			t.Fatalf("semester %d: %d ECTS, the page says %d", s.Number, s.ECTS(), s.ExpectedECTS)
		}
		total += s.ECTS()
	}
	if total != 240 {
		t.Fatalf("total %d", total)
	}
	slot := c.Semesters[0].Items[8].Slot
	if slot == nil || slot.Kind != "NAE" || !reflect.DeepEqual(slot.Options, []string{"MDE 190", "MDE 192"}) {
		t.Fatalf("four-character placeholder: %+v", c.Semesters[0].Items[8])
	}
}

// A row the parser never sees (here: deleted) makes the semester's sum differ
// from the total the portal prints: the import is refused.
func TestMissingRowIsCaughtByTheTotals(t *testing.T) {
	// The last row of semester 1: no gap in the numbering, only the totals show it.
	var kept []string
	for _, l := range strings.Split(loadSample(t), "\n") {
		if !strings.Contains(l, "Foreign language 1 (MDE 190, MDE 192)") {
			kept = append(kept, l)
		}
	}
	text := strings.Join(kept, "\n")
	if text == loadSample(t) {
		t.Fatal("test setup: row not found")
	}
	c, err := Parse(text)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Warnings) != 0 || c.ImportProblem() != "ects_mismatch" {
		t.Fatalf("warnings %q, problem %q", c.Warnings, c.ImportProblem())
	}
}

// A missing row that the totals can't see (a 0-ECTS course, an elective-list
// entry) shows as a gap in the numbering; a page without totals can't be checked.
func TestGapsAndMissingTotalsBlockTheImport(t *testing.T) {
	gap := strings.Replace(loadSample(t), "4 \tMDE 160 \tCommunity engagement and value based Society 1 \t \t0 \t1+0 \t1 \t0\n", "", 1)
	if gap == loadSample(t) {
		t.Fatal("test setup: 0-ECTS row not found")
	}
	c, err := Parse(gap)
	if err != nil {
		t.Fatal(err)
	}
	if c.ImportProblem() != "unreadable_rows" || len(c.Warnings) != 1 || !strings.Contains(c.Warnings[0], "MDE 171") {
		t.Fatalf("0-ECTS row missing: problem %q, warnings %q", c.ImportProblem(), c.Warnings)
	}
	listGap := strings.Replace(loadSample(t), "2 \tMAT 129 \tSymbolic logic \t2 \t1+0 \t3 \t5 \t \n", "", 1)
	if listGap == loadSample(t) {
		t.Fatal("test setup: elective-list row not found")
	}
	if c, _ := Parse(listGap); c.ImportProblem() != "unreadable_rows" {
		t.Fatalf("elective-list entry missing: %q", c.ImportProblem())
	}
	noTotals := regexp.MustCompile(`(?mi)^total ects:.*$`).ReplaceAllString(loadSample(t), "")
	if c, _ := Parse(noTotals); c.ImportProblem() != "no_totals" {
		t.Fatalf("no totals: %q", c.ImportProblem())
	}
	if c, _ := Parse(loadSample(t)); c.ImportProblem() != "" {
		t.Fatalf("the full page: %q %q", c.ImportProblem(), c.Warnings)
	}
}

// Portal typos seen on 2026-10105 Mathematics: Cyrillic "ХХ" in a placeholder
// code ("PED 4ХХ"), a Cyrillic "К" in a name, and options that give the
// prefix only once ("MDE 012, 022, 112,113").
func TestPortalTyposInCodesAndOptions(t *testing.T) {
	text := "2026-10105 Mathematics (EN)\nMain Track\nBachelor\n1\n" +
		"1\tPED 111\tLinear Algebra\t\t2\t1+0\t3\t5\n" +
		"2\tPED 4ХХ\t* [ NAE ] Foreign language 2 (MDE 198, MDE 200)\t\t0\t3+0\t3\t5\n" +
		"3\tPED 2XX\t* [ NAE ] Кazakh language 2 / Russian language 2 (MDE 012, 022, 112,113)\t\t0\t3+0\t3\t5\n" +
		"Total ects: 15\nTOTAL ECTS: 15\n"
	c, err := Parse(text)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Warnings) != 0 || c.ImportProblem() != "" {
		t.Fatalf("warnings %q, problem %q", c.Warnings, c.ImportProblem())
	}
	items := c.Semesters[0].Items
	if len(items) != 3 || items[1].Slot == nil || !reflect.DeepEqual(items[1].Slot.Options, []string{"MDE 198", "MDE 200"}) {
		t.Fatalf("Cyrillic XX placeholder: %+v", items)
	}
	if s := items[2].Slot; s.Label != "Kazakh language 2 / Russian language 2" || !reflect.DeepEqual(s.Options, []string{"MDE 012", "MDE 022", "MDE 112", "MDE 113"}) {
		t.Fatalf("options with one prefix: %+v", s)
	}
}

// Saved portal pages of 2023-2026: zero-width spaces in a title, a
// placeholder written "XXX ECO" instead of "ECO XXX".
func TestPortalInvisibleCharsAndReversedPlaceholder(t *testing.T) {
	text := "2024-10338 Russian language and literature in schools with non-Russian languages\u200b\u200bo (RU)\nMain Track\nBachelor\n1\n" +
		"1 ECO 101 Microeconomics 2 1+0 3 5\n" +
		"2 XXX ECO * [ AE ] ECO 521 / ECO 633 2 1+0 3 5\n" +
		"Total ects: 10\nTOTAL ECTS: 10\n"
	c, err := Parse(text)
	if err != nil {
		t.Fatal(err)
	}
	if c.ImportProblem() != "" || c.Title != "Russian language and literature in schools with non-Russian languageso" {
		t.Fatalf("problem %q, title %q, warnings %q", c.ImportProblem(), c.Title, c.Warnings)
	}
	if s := c.Semesters[0].Items[1].Slot; s == nil || s.Kind != "AE" {
		t.Fatalf("reversed placeholder: %+v", c.Semesters[0].Items[1])
	}
}
