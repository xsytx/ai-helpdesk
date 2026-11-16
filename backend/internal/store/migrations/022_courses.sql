-- Courses (Sprint 6, stories 16-18). The catalogue comes from the SDU
-- portal's public "Curricula" pages: an admin copies a program's track page
-- (Ctrl+A, Ctrl+C) into the admin panel and internal/curricula reads it
-- (those pages hold no personal data).

-- Programs by the portal's code ("10107" = Computer Science, EN, bachelor).
-- level: B bachelor, M master, DR / DS doctoral; tag: DD, MBA, EMBA.
CREATE TABLE IF NOT EXISTS programs (
    code    TEXT PRIMARY KEY,
    title   TEXT NOT NULL,
    level   TEXT NOT NULL DEFAULT 'B',
    tag     TEXT NOT NULL DEFAULT '',
    cipher  TEXT NOT NULL DEFAULT '',
    lang    TEXT NOT NULL DEFAULT '',
    faculty TEXT NOT NULL DEFAULT ''
);

-- Courses by code ("MAT 101"): one row however many programs use it. Names
-- come from the portal (English); descriptions are written by admins.
CREATE TABLE IF NOT EXISTS courses (
    code           TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    theory         INTEGER NOT NULL DEFAULT 0,
    practice       TEXT NOT NULL DEFAULT '',
    hours          INTEGER NOT NULL DEFAULT 0,
    ects           INTEGER NOT NULL DEFAULT 0,
    description    TEXT NOT NULL DEFAULT '',
    description_kz TEXT NOT NULL DEFAULT '',
    description_ru TEXT NOT NULL DEFAULT '',
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courses_name_trgm ON courses USING gin (lower(name) gin_trgm_ops);

-- One imported curriculum: a program's plan for an entry year and a track.
CREATE TABLE IF NOT EXISTS curricula (
    id           BIGSERIAL PRIMARY KEY,
    program_code TEXT NOT NULL REFERENCES programs(code) ON DELETE CASCADE,
    year         INTEGER NOT NULL,
    track        TEXT NOT NULL,
    imported_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    imported_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (program_code, year, track)
);

-- Its semesters: a fixed course (course_code) or an elective slot (slot_*;
-- options = the course codes to choose from).
CREATE TABLE IF NOT EXISTS curriculum_items (
    curriculum_id BIGINT  NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
    semester      INTEGER NOT NULL,
    position      INTEGER NOT NULL,
    course_code   TEXT REFERENCES courses(code) ON DELETE CASCADE,
    slot_kind     TEXT NOT NULL DEFAULT '',
    slot_label    TEXT NOT NULL DEFAULT '',
    options       TEXT[] NOT NULL DEFAULT '{}',
    ects          INTEGER NOT NULL DEFAULT 0,
    hours         INTEGER NOT NULL DEFAULT 0,
    marked        BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (curriculum_id, semester, position)
);
CREATE INDEX IF NOT EXISTS curriculum_items_course_idx ON curriculum_items (course_code);
CREATE INDEX IF NOT EXISTS curriculum_items_options_idx ON curriculum_items USING gin (options);

-- The elective lists at the bottom of the page (AE, NAE, NTE, RC, SA).
CREATE TABLE IF NOT EXISTS curriculum_electives (
    curriculum_id BIGINT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
    kind          TEXT   NOT NULL,
    course_code   TEXT   NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
    PRIMARY KEY (curriculum_id, kind, course_code)
);

-- A student's program and entry year (the Courses page opens on them).
CREATE TABLE IF NOT EXISTS user_programs (
    user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    program_code TEXT NOT NULL REFERENCES programs(code) ON DELETE CASCADE,
    entry_year   INTEGER NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The program lists of F_ENG, F_PHIL and F_LAW (2026), added once; an import
-- adds a program that is missing and leaves these as they are.
INSERT INTO programs (code, level, tag, cipher, title, lang, faculty) VALUES
    ('10101', 'B', '', '6B05401', 'Mathematics', 'EN', 'F_ENG'),
    ('10103', 'B', '', '6B06101', 'Information Systems', 'EN', 'F_ENG'),
    ('10107', 'B', '', '6B06102', 'Computer Science', 'EN', 'F_ENG'),
    ('10109', 'B', '', '6B06103', 'Mathematical and Computer Modeling', 'EN', 'F_ENG'),
    ('10110', 'B', '', '6B06104', 'Multimedia Sciences', 'EN', 'F_ENG'),
    ('10118', 'B', '', '6B06105', 'Software Engineering', 'EN', 'F_ENG'),
    ('10120', 'B', 'DD', '6B06107', 'Business information systems', 'EN', 'F_ENG'),
    ('10132', 'B', '', '6B06108', 'Applied Mathematics and Computer Modeling', 'EN', 'F_ENG'),
    ('10137', 'B', '', '6B06109', 'Computer Science', 'EN', 'F_ENG'),
    ('10183', 'B', '', '6B05402', 'Statistics and Data Science', 'EN', 'F_ENG'),
    ('11101', 'M', '', '7M05401', 'Mathematics', 'EN', 'F_ENG'),
    ('11103', 'M', '', '7M06101', 'Information Systems', 'EN', 'F_ENG'),
    ('11107', 'M', '', '7M06102', 'Computer Science', 'EN', 'F_ENG'),
    ('11111', 'M', '', '7M05402', 'Financial Mathematics', 'EN', 'F_ENG'),
    ('11112', 'M', '', '7M06105', 'Software Engineering', 'EN', 'F_ENG'),
    ('11117', 'M', '', '7M06104', 'Data Science', 'EN', 'F_ENG'),
    ('12101', 'DR', '', '8D05401', 'Mathematics', 'EN', 'F_ENG'),
    ('12107', 'DR', '', '8D06102', 'Computer Science', 'EN', 'F_ENG'),
    ('13101', 'DS', '', '8D05401', 'Mathematics', 'EN', 'F_ENG'),
    ('13107', 'DS', '', '8D06102', 'Computer Science', 'EN', 'F_ENG'),
    ('10105', 'B', '', '6B01501', 'Mathematics', 'EN', 'F_PHIL'),
    ('10114', 'B', '', '6B01507', 'Biology', 'EN', 'F_PHIL'),
    ('10116', 'B', '', '6B01504', 'Informatics', 'EN', 'F_PHIL'),
    ('10121', 'B', '', '6B01505', 'Physics', 'EN', 'F_PHIL'),
    ('10125', 'B', '', '6B01506', 'Chemistry', 'EN', 'F_PHIL'),
    ('10131', 'B', '', '6B01703', 'Foreign Language: Two Foreign Languages', 'KO', 'F_PHIL'),
    ('10133', 'B', '', '6B01704', 'Foreign Language: Two Foreign Languages (Birkbeck)', 'EN', 'F_PHIL'),
    ('10301', 'B', '', '6B01701', 'Kazakh Language and Literature', 'KZ', 'F_PHIL'),
    ('10302', 'B', '', '6B01702', 'Foreign Language: Two Foreign Languages', 'EN', 'F_PHIL'),
    ('10304', 'B', '', '6B02302', 'Translation Studies', 'EN', 'F_PHIL'),
    ('10338', 'B', '', '6B01707', 'Russian language and literature in schools with Russian and non-Russian languages of instruction (IP)', 'RU', 'F_PHIL'),
    ('10381', 'B', '', '6B01101', 'Pedagogy and Psychology', 'KZ', 'F_PHIL'),
    ('10382', 'B', '', '6B01802', 'Social pedagogy', 'KZ', 'F_PHIL'),
    ('10383', 'B', '', '6B01101', 'Pedagogy and Psychology', 'EN', 'F_PHIL'),
    ('10385', 'B', '', '6B01802', 'Social pedagogy', 'EN', 'F_PHIL'),
    ('10387', 'B', '', '6B01301', 'Pedagogics and Methods of Primary Education', 'KZ', 'F_PHIL'),
    ('10481', 'B', '', '6B01601', 'History', 'KZ', 'F_PHIL'),
    ('11105', 'M', '', '7M01501', 'Mathematics', 'EN', 'F_PHIL'),
    ('11114', 'M', '', '7M01504', 'Biology', 'EN', 'F_PHIL'),
    ('11122', 'M', '', '7M01505', 'Informatics and Digital Pedagogy', 'EN', 'F_PHIL'),
    ('11134', 'M', '', '7M01101', 'Pedagogy and psychology', 'KZ', 'F_PHIL'),
    ('11135', 'M', '', '7M01101', 'Pedagogy and psychology', 'RU', 'F_PHIL'),
    ('11136', 'M', '', '7M01101', 'Pedagogy and psychology', 'EN', 'F_PHIL'),
    ('11301', 'M', '', '7M01701', 'Kazakh Language and Literature', 'KZ', 'F_PHIL'),
    ('11302', 'M', '', '7M01702', 'Foreign Language: Two Foreign Languages', 'EN', 'F_PHIL'),
    ('11323', 'M', '', '7M01702', 'Foreign Language: Two Foreign Languages', 'EN', 'F_PHIL'),
    ('11333', 'M', '', '7M01101', 'Psychology in Education: Counselling', 'KZ', 'F_PHIL'),
    ('11334', 'M', '', '7M01101', 'Psychology in Education: Counselling', 'RU', 'F_PHIL'),
    ('11335', 'M', '', '7M01101', 'Psychology in Education: Counselling', 'EN', 'F_PHIL'),
    ('11336', 'M', '', '7M01601', 'History', 'KZ', 'F_PHIL'),
    ('11337', 'M', '', '7M01601', 'History', 'RU', 'F_PHIL'),
    ('11343', 'M', '', '7M01502', 'Chemistry', 'EN', 'F_PHIL'),
    ('11346', 'M', '', '7M01503', 'Physics', 'EN', 'F_PHIL'),
    ('12105', 'DR', '', '8D01501', 'Mathematics', 'EN', 'F_PHIL'),
    ('12301', 'DR', '', '8D01701', 'Kazakh Language and Literature', 'KZ', 'F_PHIL'),
    ('12302', 'DR', '', '8D01702', 'Foreign Language: Two Foreign Languages', 'EN', 'F_PHIL'),
    ('13105', 'DS', '', '8D01501', 'Mathematics', 'EN', 'F_PHIL'),
    ('20381', 'B', '', '6B02304', 'Applied philology', 'KZ', 'F_PHIL'),
    ('10127', 'B', '', '6B03205', 'Multimedia and AI journalism', 'KZ', 'F_LAW'),
    ('10128', 'B', '', '6B03205', 'Multimedia and AI journalism', 'EN', 'F_LAW'),
    ('10130', 'B', '', '6B04106', 'Management', 'EN', 'F_LAW'),
    ('10201', 'B', '', '6B04105', 'Digital Marketing', 'EN', 'F_LAW'),
    ('10202', 'B', '', '6B03101', 'International Relations', 'EN', 'F_LAW'),
    ('10203', 'B', '', '6B04102', 'Management', 'EN', 'F_LAW'),
    ('10204', 'B', '', '6B04104', 'Finance', 'EN', 'F_LAW'),
    ('10205', 'B', '', '6B04101', 'Economics', 'EN', 'F_LAW'),
    ('10207', 'B', '', '6B04103', 'Accounting and Audit', 'EN', 'F_LAW'),
    ('10210', 'B', '', '6B04202', 'International Law', 'EN', 'F_LAW'),
    ('10331', 'B', '', '6B03103', 'Applied Psychology', 'KZ', 'F_LAW'),
    ('10332', 'B', '', '6B03103', 'Applied Psychology', 'EN', 'F_LAW'),
    ('10401', 'B', '', '6B04201', 'Applied law', 'KZ', 'F_LAW'),
    ('10403', 'B', '', '6B04201', 'Applied law', 'RU', 'F_LAW'),
    ('10484', 'B', '', '6B04203', 'Law of Public administration', 'KZ', 'F_LAW'),
    ('11123', 'M', 'MBA', '7M04113', 'MBA Management', 'KZ', 'F_LAW'),
    ('11124', 'M', 'EMBA', '7M04114', 'EMBA Management', 'KZ', 'F_LAW'),
    ('11126', 'M', '', '7M03205', 'Media Management and PR', 'KZ', 'F_LAW'),
    ('11129', 'M', '', '7M03205', 'Media Management and PR', 'EN', 'F_LAW'),
    ('11138', 'M', 'DD', '7M03103', 'Psychology', 'EN', 'F_LAW'),
    ('11205', 'M', 'EMBA', '7M04108', 'Digital Transformation Management', 'EN', 'F_LAW'),
    ('11216', 'M', '', '7M04106', 'Financial Technology', 'EN', 'F_LAW'),
    ('11218', 'M', '', '7M04115', 'Management', 'EN', 'F_LAW'),
    ('11219', 'M', '', '7M04109', 'Project Management', 'EN', 'F_LAW'),
    ('11221', 'M', 'EMBA', '7M04105', 'Management in healthcare', 'KZ', 'F_LAW'),
    ('11222', 'M', 'EMBA', '7M04105', 'Management in healthcare', 'RU', 'F_LAW'),
    ('11223', 'M', '', '7M04110', 'Economics and Business Analytics', 'EN', 'F_LAW'),
    ('11225', 'M', '', '7M04112', 'Management in Education', 'KZ', 'F_LAW'),
    ('11226', 'M', '', '7M04112', 'Management in Education', 'RU', 'F_LAW'),
    ('11227', 'M', '', '7M03102', 'International Relations: Eurasian studies', 'EN', 'F_LAW'),
    ('11241', 'M', 'MBA', '7M04104', 'Management in healthcare', 'KZ', 'F_LAW'),
    ('11242', 'M', 'MBA', '7M04104', 'Management in healthcare', 'RU', 'F_LAW'),
    ('11243', 'M', '', '7M04103', 'Economics and Data Analysis', 'EN', 'F_LAW'),
    ('11308', 'M', '', '7M03201', 'Media Studies and Journalism', 'KZ', 'F_LAW'),
    ('11309', 'M', '', '7M03201', 'Media Studies and Journalism', 'EN', 'F_LAW'),
    ('11401', 'M', '', '7M04201', 'Private Law', 'KZ', 'F_LAW'),
    ('11402', 'M', '', '7M04201', 'Private Law', 'RU', 'F_LAW'),
    ('11405', 'M', '', '7M04202', 'Information Technology Law', 'RU', 'F_LAW'),
    ('11406', 'M', '', '7M04202', 'Information Technology Law', 'RU', 'F_LAW'),
    ('11410', 'M', '', '7M04204', 'International Business Law', 'RU', 'F_LAW'),
    ('12203', 'DR', '', '8D04101', 'Management', 'EN', 'F_LAW'),
    ('12401', 'DR', '', '8D04201', 'Applied law', 'KZ', 'F_LAW'),
    ('12403', 'DR', '', '8D04201', 'Applied law', 'RU', 'F_LAW'),
    ('13401', 'DS', '', '8D04201', 'Applied law', 'KZ', 'F_LAW'),
    ('13403', 'DS', '', '8D04201', 'Applied law', 'RU', 'F_LAW')
ON CONFLICT (code) DO NOTHING;

-- The portal spells three master's titles "pshychology": shown corrected
-- (also in databases seeded before this fix).
UPDATE programs SET title = 'Pedagogy and psychology' WHERE title = 'Pedagogy and pshychology';
