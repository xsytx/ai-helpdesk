-- Course reviews' hexagon (Sprint 6): three more scores about the course
-- itself (not the instructor): how interesting, how practical, how
-- beginner-friendly, 1-5 each. NULL = a review written before they existed
-- (it isn't counted on those axes).
ALTER TABLE course_reviews ADD COLUMN IF NOT EXISTS interest  SMALLINT;
ALTER TABLE course_reviews ADD COLUMN IF NOT EXISTS practical SMALLINT;
ALTER TABLE course_reviews ADD COLUMN IF NOT EXISTS beginner  SMALLINT;

DO $$ BEGIN
    ALTER TABLE course_reviews ADD CONSTRAINT course_reviews_axes_check CHECK (
        (interest IS NULL OR interest BETWEEN 1 AND 5)
        AND (practical IS NULL OR practical BETWEEN 1 AND 5)
        AND (beginner IS NULL OR beginner BETWEEN 1 AND 5));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
