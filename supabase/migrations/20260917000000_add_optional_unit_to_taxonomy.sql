ALTER TABLE IF EXISTS public.submissions
  ADD COLUMN IF NOT EXISTS unit text NULL;

ALTER TABLE IF EXISTS public.questions
  ADD COLUMN IF NOT EXISTS unit text NULL;

ALTER TABLE IF EXISTS public.question_suggestions
  ADD COLUMN IF NOT EXISTS unit_name text NULL;

ALTER TABLE IF EXISTS public.submissions
  DROP CONSTRAINT IF EXISTS submissions_chair_check;

ALTER TABLE IF EXISTS public.submissions
  ALTER COLUMN chair DROP NOT NULL;

ALTER TABLE IF EXISTS public.questions
  ALTER COLUMN chair_id DROP NOT NULL;

ALTER TABLE IF EXISTS public.questions
  ALTER COLUMN subject_id DROP NOT NULL;

ALTER TABLE IF EXISTS public.questions
  ALTER COLUMN university DROP NOT NULL;

ALTER TABLE IF EXISTS public.questions
  ALTER COLUMN subject DROP NOT NULL;

ALTER TABLE IF EXISTS public.questions
  ALTER COLUMN chair DROP NOT NULL;

CREATE INDEX IF NOT EXISTS submissions_unit_idx ON public.submissions(unit);
CREATE INDEX IF NOT EXISTS questions_unit_idx ON public.questions(unit);
CREATE INDEX IF NOT EXISTS question_suggestions_unit_name_idx ON public.question_suggestions(unit_name);
