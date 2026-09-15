ALTER TABLE IF EXISTS public.questions
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'official' CHECK (source_type IN ('official', 'suggestion'));

ALTER TABLE IF EXISTS public.questions
  ADD COLUMN IF NOT EXISTS author_name text NULL;
