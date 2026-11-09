/* Keep the original questions schema readable while exposing the current API shape. */

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS question text,
  ADD COLUMN IF NOT EXISTS options text[],
  ADD COLUMN IF NOT EXISTS correct_option integer,
  ADD COLUMN IF NOT EXISTS explanation text,
  ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS chair_id uuid REFERENCES public.chairs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS university text,
  ADD COLUMN IF NOT EXISTS chair text,
  ADD COLUMN IF NOT EXISTS difficulty text DEFAULT 'media',
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

UPDATE public.questions
SET
  question = COALESCE(question, pregunta),
  options = COALESCE(options, opciones),
  correct_option = COALESCE(correct_option, correcta),
  explanation = COALESCE(explanation, explicacion)
WHERE question IS NULL
   OR options IS NULL
   OR correct_option IS NULL
   OR explanation IS NULL;

UPDATE public.questions AS q
SET
  university = COALESCE(q.university, s.university),
  subject = COALESCE(q.subject, s.subject),
  chair = COALESCE(q.chair, s.chair)
FROM public.submissions AS s
WHERE q.submission_id = s.id
  AND (q.university IS NULL OR q.subject IS NULL OR q.chair IS NULL);

UPDATE public.questions AS q
SET subject_id = s.id
FROM public.subjects AS s
WHERE q.subject_id IS NULL
  AND q.subject IS NOT NULL
  AND public.normalize_taxonomy_key(s.name) = public.normalize_taxonomy_key(q.subject);

UPDATE public.questions
SET difficulty = 'media'
WHERE difficulty IS NULL OR difficulty NOT IN ('facil', 'media', 'dificil');

UPDATE public.questions AS q
SET chair_id = c.id
FROM public.chairs AS c
WHERE q.chair_id IS NULL
  AND q.subject IS NOT NULL
  AND q.chair IS NOT NULL
  AND c.subject_id = q.subject_id
  AND public.normalize_taxonomy_key(c.name) = public.normalize_taxonomy_key(q.chair);

CREATE INDEX IF NOT EXISTS questions_chair_id_idx ON public.questions(chair_id);
CREATE INDEX IF NOT EXISTS questions_subject_id_idx ON public.questions(subject_id);
CREATE INDEX IF NOT EXISTS questions_subject_idx ON public.questions(subject);
CREATE INDEX IF NOT EXISTS questions_active_idx ON public.questions(active);
