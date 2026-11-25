-- AI summary of a course's reviews (Courses, stories 17-18): one per course
-- and language, made by ai_ml from the published ("ok") reviews only.
-- fingerprint = which reviews (and which versions of them) it was made from;
-- when they change, the next view makes a new one.
CREATE TABLE IF NOT EXISTS course_review_summaries (
    course_code  TEXT        NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
    lang         TEXT        NOT NULL CHECK (lang IN ('en', 'kz', 'ru')),
    fingerprint  TEXT        NOT NULL,
    review_count INTEGER     NOT NULL,
    summary      TEXT        NOT NULL,
    liked        JSONB       NOT NULL DEFAULT '[]',
    warnings     JSONB       NOT NULL DEFAULT '[]',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (course_code, lang)
);
