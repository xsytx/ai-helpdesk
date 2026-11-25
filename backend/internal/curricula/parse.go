// Package curricula reads a program's curriculum as copied from the SDU
// portal (Curricula → a program → a track: select the page, Ctrl+A, Ctrl+C)
// and turns it into semesters, courses and elective slots. The copied text
// keeps the table cells separated by tabs or spaces; everything around the
// tables (menus, headers, "Total ects") is ignored, so admins can paste the
// whole page. Names never carry personal data: the course list only.
package curricula

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// Curriculum is one program's course plan for one entry year and track.
type Curriculum struct {
	Year        int        `json:"year"`
	ProgramCode string     `json:"program_code"`
	Title       string     `json:"title"`
	Lang        string     `json:"lang"`
	Track       string     `json:"track"`
	Level       string     `json:"level"`
	Semesters   []Semester `json:"semesters"`
	// The elective lists at the bottom of the page: kind (AE, NAE, NTE, RC,
	// SA) → the courses students may choose.
	Electives map[string][]Course `json:"electives"`
	// Lines that looked like course rows but could not be read.
	Warnings []string `json:"warnings"`
	// "TOTAL ECTS: 240" as printed under the plan (0 = not in the text).
	ExpectedECTS int `json:"expected_ects"`
}

// Semester is one term of the plan (1–8 for a bachelor).
type Semester struct {
	Number int    `json:"number"`
	Items  []Item `json:"items"`
	// "Total ects: 27" as printed under the semester (0 = not in the text).
	ExpectedECTS int `json:"expected_ects"`
}

// ECTS adds up the semester's rows.
func (s Semester) ECTS() int {
	n := 0
	for _, it := range s.Items {
		if it.Course != nil {
			n += it.Course.ECTS
		} else if it.Slot != nil {
			n += it.Slot.ECTS
		}
	}
	return n
}

// Item is a row of a semester: a fixed course, or an elective slot ("pick
// one of these").
type Item struct {
	// Course is set for a fixed course.
	Course *Course `json:"course,omitempty"`
	// Slot is set for an elective slot.
	Slot *Slot `json:"slot,omitempty"`
	// Marked: the row's number had a star on the portal ("2*").
	Marked bool `json:"marked"`
}

// Slot is an elective place in a semester.
type Slot struct {
	Kind     string   `json:"kind"`    // AE, NAE, NTE…
	Label    string   `json:"label"`   // "Elective 2", "Foreign language 1"
	Options  []string `json:"options"` // course codes ("MAT 127")
	Theory   int      `json:"theory"`
	Practice string   `json:"practice"`
	Hours    int      `json:"hours"`
	ECTS     int      `json:"ects"`
}

// Course is one course row.
type Course struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	Theory   int    `json:"theory"`
	Practice string `json:"practice"` // as on the portal: "2+0"
	Hours    int    `json:"hours"`
	ECTS     int    `json:"ects"`
}

var (
	headerRx   = regexp.MustCompile(`^(\d{4})-(\d{5})\s+(.+?)\s*\(([A-Z]{2})\)$`)
	semesterRx = regexp.MustCompile(`^(\d{1,2})$`)
	sectionRx  = regexp.MustCompile(`^([A-Z]{2,3})\s+-\s+(.+)$`)
	// № (maybe starred), code, name, then theory, practice ("2+0"), hours, ECTS at the end.
	rowRx  = regexp.MustCompile(`^(\d{1,3})\s?(\*?)\s+([A-Za-z]{3,5})\s?([0-9Xx]{3,4})\s+(.+?)\s+(\d{1,2})\s+(\d{1,2}\+\d{1,2})\s+(\d{1,2})\s+(\d{1,2})$`)
	slotRx = regexp.MustCompile(`^\*\s*\[\s*([A-Z]{2,4})\s*\]\s*(.+)$`)
	codeRx = regexp.MustCompile(`^([A-Za-z]{3,5})\s?(\d{3,4})$`)
	// "Total ects: 27" under a semester, "TOTAL ECTS: 240" under the plan.
	semTotalRx  = regexp.MustCompile(`^Total ects:\s*(\d{1,3})$`)
	planTotalRx = regexp.MustCompile(`^TOTAL ECTS:\s*(\d{1,3})$`)
	spaceRx     = regexp.MustCompile(`\s+`)
)

// Levels as written under the track name.
var levels = map[string]string{"bachelor": "B", "master": "M", "doctoral": "D", "phd": "D"}

// MaxText is the most text Parse accepts (a curriculum page is ~15 KB).
const MaxText = 300_000

// ParseError says why a text is not one curriculum. Code is shown to admins
// in their language: too_long, no_header, no_semesters, two_curricula.
type ParseError struct{ Code string }

func (e *ParseError) Error() string { return e.Code }

// rowStartRx: the start of a course row ("3* MAT 203 …"), to rejoin a row
// the copy split over several lines.
var rowStartRx = regexp.MustCompile(`^\d{1,3}\s?\*?\s+[A-Za-z]{3,5}\s?[0-9Xx]{3,4}\b`)

// Invisible characters the portal sometimes has in titles ("languages​​o").
var invisible = strings.NewReplacer("\u200b", "", "\u200c", "", "\u200d", "", "\u2060", "", "\ufeff", "", "\u00a0", " ")

// A placeholder written the wrong way round on the portal: "7 XXX ECO * [ AE ] …" = "7 ECO XXX …".
var reversedSlotRx = regexp.MustCompile(`^(\d{1,3}\s?\*?\s+)XXX\s+([A-Za-z]{3,5})\s`)

// cleanLine squeezes spaces, drops invisible characters, fixes look-alike
// letters and reversed placeholders (the same as squeeze in portalPage.ts).
func cleanLine(raw string) string {
	line := CleanText(strings.TrimSpace(spaceRx.ReplaceAllString(invisible.Replace(raw), " ")))
	return reversedSlotRx.ReplaceAllString(line, "${1}${2} XXX ")
}

// Parse reads one copied curriculum page.
func Parse(text string) (Curriculum, error) {
	c := Curriculum{Electives: map[string][]Course{}, Semesters: []Semester{}, Warnings: []string{}}
	if len(text) > MaxText {
		return c, &ParseError{"too_long"}
	}
	inElectives := false
	section := ""
	afterHeader := 0
	// Rows are numbered 1, 2, 3… in each semester and each elective list: a gap
	// means a row was not read (a 0-ECTS course would not show in the totals).
	expectNo := 0
	// A row split over lines ("MAT 101 Mathematical" / "analysis 1 2 2+0 4 5"), being joined.
	pending := ""
	pendingLines := 0
	flush := func() {
		if pending != "" {
			c.Warnings = append(c.Warnings, pending)
		}
		pending, pendingLines = "", 0
	}

	row := func(m []string, line string) {
		if n, _ := strconv.Atoi(m[1]); expectNo > 0 {
			if n != expectNo {
				c.Warnings = append(c.Warnings, "a row is missing before: "+line)
			}
			expectNo = n + 1
		}
		theory, _ := strconv.Atoi(m[6])
		hours, _ := strconv.Atoi(m[8])
		ects, _ := strconv.Atoi(m[9])
		code := strings.ToUpper(m[3]) + " " + strings.ToUpper(m[4])
		name := CleanText(m[5])
		// "XXX 1XX", "MAT xxx": a placeholder for an elective, not a course (only the
		// number part counts: prefixes like EXT contain an X).
		placeholder := strings.ContainsAny(m[4], "Xx")
		if inElectives {
			if section != "" && !placeholder {
				c.Electives[section] = append(c.Electives[section], Course{Code: code, Name: name, Theory: theory, Practice: m[7], Hours: hours, ECTS: ects})
			}
			return
		}
		if len(c.Semesters) == 0 {
			c.Warnings = append(c.Warnings, line)
			return
		}
		sem := &c.Semesters[len(c.Semesters)-1]
		item := Item{Marked: m[2] == "*"}
		if s := slotRx.FindStringSubmatch(name); s != nil {
			label, options := splitOptions(s[2])
			item.Slot = &Slot{Kind: s[1], Label: label, Options: options, Theory: theory, Practice: m[7], Hours: hours, ECTS: ects}
		} else if placeholder {
			// A placeholder code without the "* [ KIND ]" mark: a slot without options.
			item.Slot = &Slot{Label: name, Options: []string{}, Theory: theory, Practice: m[7], Hours: hours, ECTS: ects}
		} else {
			item.Course = &Course{Code: code, Name: name, Theory: theory, Practice: m[7], Hours: hours, ECTS: ects}
		}
		sem.Items = append(sem.Items, item)
	}

	for _, raw := range strings.Split(text, "\n") {
		// Cyrillic look-alike letters typed into codes on the portal ("PED 4ХХ") become Latin.
		line := cleanLine(raw)
		if line == "" {
			continue
		}
		if m := headerRx.FindStringSubmatch(line); m != nil {
			// Two tracks (or two programs) pasted at once: import them one by one.
			if c.ProgramCode != "" {
				return c, &ParseError{"two_curricula"}
			}
			c.Year, _ = strconv.Atoi(m[1])
			c.ProgramCode = m[2]
			c.Title = CleanText(m[3])
			c.Lang = m[4]
			afterHeader = 1
			continue
		}
		// The two lines after the header: the track, then the level.
		if afterHeader == 1 && !semesterRx.MatchString(line) {
			c.Track = CleanText(line)
			afterHeader = 2
			continue
		}
		if afterHeader == 2 && !semesterRx.MatchString(line) {
			if lv, ok := levels[strings.ToLower(line)]; ok {
				c.Level = lv
			}
			afterHeader = 0
			continue
		}
		afterHeader = 0

		// The rest of a split row (its name or its last cells on the next lines).
		// A new row or heading ends it (never glue two rows into one); a lone
		// number may be one of its cells, so it is tried as a continuation.
		if pending != "" {
			if rowStartRx.MatchString(line) || sectionRx.MatchString(line) || strings.EqualFold(line, "ELECTIVE COURSES") ||
				semTotalRx.MatchString(line) || planTotalRx.MatchString(line) {
				flush()
			} else {
				joined := pending + " " + line
				if m := rowRx.FindStringSubmatch(joined); m != nil {
					pending, pendingLines = "", 0
					row(m, joined)
					continue
				}
				if pendingLines < 5 {
					pending, pendingLines = joined, pendingLines+1
					continue
				}
				flush()
			}
		}

		if m := planTotalRx.FindStringSubmatch(line); m != nil {
			c.ExpectedECTS, _ = strconv.Atoi(m[1])
			continue
		}
		if m := semTotalRx.FindStringSubmatch(line); m != nil {
			if len(c.Semesters) > 0 && !inElectives {
				c.Semesters[len(c.Semesters)-1].ExpectedECTS, _ = strconv.Atoi(m[1])
			}
			continue
		}
		if strings.EqualFold(line, "ELECTIVE COURSES") {
			inElectives = true
			expectNo = 0
			continue
		}
		if inElectives {
			if m := sectionRx.FindStringSubmatch(line); m != nil {
				section = m[1]
				expectNo = 1
				continue
			}
		} else if m := semesterRx.FindStringSubmatch(line); m != nil {
			n, _ := strconv.Atoi(m[1])
			if n >= 1 && n <= 12 {
				c.Semesters = append(c.Semesters, Semester{Number: n, Items: []Item{}})
				expectNo = 1
			}
			continue
		}

		if m := rowRx.FindStringSubmatch(line); m != nil {
			row(m, line)
			continue
		}
		if rowStartRx.MatchString(line) {
			pending, pendingLines = line, 1
		}
	}
	flush()
	if c.ProgramCode == "" {
		return c, &ParseError{"no_header"}
	}
	if len(c.Semesters) == 0 {
		return c, &ParseError{"no_semesters"}
	}
	return c, nil
}

// ImportProblem says why this curriculum must not be imported as it is
// (an import replaces the earlier one, so a half-read page would lose
// courses): "unreadable_rows" when a row could not be read or the numbering
// has a gap, "empty_semester" when a semester has no rows, "no_totals" when
// the "Total ects" lines the portal prints are missing (they are the check),
// "ects_mismatch" when the rows don't add up to them (a row was missed), ""
// when it is fine. The preview still shows it.
func (c Curriculum) ImportProblem() string {
	if len(c.Warnings) > 0 {
		return "unreadable_rows"
	}
	total := 0
	for _, s := range c.Semesters {
		if len(s.Items) == 0 {
			return "empty_semester"
		}
		if s.ExpectedECTS == 0 {
			return "no_totals"
		}
		// The portal's own total for the semester: a row the parser missed shows here.
		if s.ECTS() != s.ExpectedECTS {
			return "ects_mismatch"
		}
		total += s.ECTS()
	}
	if c.ExpectedECTS == 0 {
		return "no_totals"
	}
	if total != c.ExpectedECTS {
		return "ects_mismatch"
	}
	return ""
}

// splitOptions turns "Elective 2 (MAT 127, MAT 341)" into the label and the
// codes in the last parentheses (separated by commas or slashes).
func splitOptions(s string) (string, []string) {
	s = strings.TrimSpace(s)
	options := []string{}
	if !strings.HasSuffix(s, ")") {
		return s, options
	}
	open := strings.LastIndex(s, "(")
	if open < 0 {
		return s, options
	}
	// "(MDE 012, 022, 112)": a bare number takes the prefix of the code before it.
	prefix := ""
	for _, part := range regexp.MustCompile(`[,/]`).Split(s[open+1:len(s)-1], -1) {
		part = strings.TrimSpace(CleanText(part))
		if regexp.MustCompile(`^\d{3,4}$`).MatchString(part) && prefix != "" {
			part = prefix + " " + part
		}
		if code, ok := NormalizeCode(part); ok {
			options = append(options, code)
			prefix = code[:strings.Index(code, " ")]
		}
	}
	if len(options) == 0 {
		return s, options
	}
	return strings.TrimSpace(s[:open]), options
}

// NormalizeCode turns " mat127 " into "MAT 127"; ok is false for anything else.
func NormalizeCode(s string) (string, bool) {
	m := codeRx.FindStringSubmatch(strings.TrimSpace(CleanText(s)))
	if m == nil {
		return "", false
	}
	return strings.ToUpper(m[1]) + " " + m[2], true
}

// Cyrillic letters that look like Latin ones, as found in portal names
// ("Еconomy", "А2 level").
var lookalikes = map[rune]rune{
	'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X',
	'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
}

// CleanText trims and squeezes spaces, and in words that are otherwise Latin
// (or a level like "А2") replaces Cyrillic look-alike letters with Latin ones,
// so search finds "Economy". Real Kazakh/Russian words stay as they are.
func CleanText(s string) string {
	words := strings.Fields(s)
	for i, w := range words {
		latin, other := false, false
		for _, r := range w {
			switch {
			case r < unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsDigit(r)):
				latin = true
			case unicode.Is(unicode.Cyrillic, r):
				if _, ok := lookalikes[r]; !ok {
					other = true
				}
			}
		}
		if !latin || other {
			continue
		}
		words[i] = strings.Map(func(r rune) rune {
			if l, ok := lookalikes[r]; ok {
				return l
			}
			return r
		}, w)
	}
	return strings.Join(words, " ")
}
