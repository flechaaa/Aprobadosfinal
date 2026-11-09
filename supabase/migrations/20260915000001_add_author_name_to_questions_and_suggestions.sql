ALTER TABLE IF EXISTS public.question_suggestions
  ADD COLUMN IF NOT EXISTS author_name text NOT NULL DEFAULT 'Anónimo';

ALTER TABLE IF EXISTS public.questions
  ADD COLUMN IF NOT EXISTS author_name text NOT NULL DEFAULT 'Anónimo';
