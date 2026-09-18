ALTER TABLE IF EXISTS public.rankings
  ADD COLUMN IF NOT EXISTS user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS university_id uuid NULL REFERENCES public.universities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subject_id uuid NULL REFERENCES public.subjects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit text NULL,
  ADD COLUMN IF NOT EXISTS correct_answers integer NOT NULL DEFAULT 0 CHECK (correct_answers >= 0),
  ADD COLUMN IF NOT EXISTS questions_answered integer NOT NULL DEFAULT 0 CHECK (questions_answered >= 0),
  ADD COLUMN IF NOT EXISTS avatar_url text NULL;

UPDATE public.rankings AS r
SET subject_id = c.subject_id,
    university_id = s.university_id
FROM public.chairs AS c
JOIN public.subjects AS s ON s.id = c.subject_id
WHERE r.chair_id = c.id
  AND (r.subject_id IS NULL OR r.university_id IS NULL);

CREATE INDEX IF NOT EXISTS rankings_university_score_idx
  ON public.rankings (university_id, score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS rankings_subject_score_idx
  ON public.rankings (subject_id, score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS rankings_unit_score_idx
  ON public.rankings (unit, score DESC, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_rankings(
  p_scope text DEFAULT 'global',
  p_university_id uuid DEFAULT NULL,
  p_subject_id uuid DEFAULT NULL,
  p_unit text DEFAULT NULL
)
RETURNS TABLE (
  rank bigint,
  player_name text,
  avatar_url text,
  total_score bigint,
  correct_answers bigint,
  questions_answered bigint,
  games_played bigint,
  best_score integer,
  university_name text,
  subject_name text,
  unit text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      r.player_name,
      r.avatar_url,
      r.score,
      r.correct_answers,
      r.questions_answered,
      r.unit,
      u.name AS university_name,
      s.name AS subject_name
    FROM public.rankings AS r
    LEFT JOIN public.universities AS u ON u.id = r.university_id
    LEFT JOIN public.subjects AS s ON s.id = r.subject_id
    WHERE
      p_scope IN ('global', 'university', 'subject', 'unit')
      AND (p_scope <> 'university' OR r.university_id = p_university_id)
      AND (p_scope <> 'subject' OR r.subject_id = p_subject_id)
      AND (p_scope <> 'unit' OR (p_subject_id IS NULL OR r.subject_id = p_subject_id) AND lower(btrim(r.unit)) = lower(btrim(p_unit)))
  ), aggregated AS (
    SELECT
      f.player_name,
      max(f.avatar_url) AS avatar_url,
      sum(f.score)::bigint AS total_score,
      sum(f.correct_answers)::bigint AS correct_answers,
      sum(f.questions_answered)::bigint AS questions_answered,
      count(*)::bigint AS games_played,
      max(f.score) AS best_score,
      max(f.university_name) AS university_name,
      max(f.subject_name) AS subject_name,
      max(f.unit) AS unit
    FROM filtered AS f
    GROUP BY f.player_name
  )
  SELECT
    row_number() OVER (ORDER BY a.total_score DESC, a.correct_answers DESC, a.best_score DESC, a.player_name ASC) AS rank,
    a.player_name,
    a.avatar_url,
    a.total_score,
    a.correct_answers,
    a.questions_answered,
    a.games_played,
    a.best_score,
    a.university_name,
    a.subject_name,
    a.unit
  FROM aggregated AS a
  ORDER BY rank
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.get_rankings(text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rankings(text, uuid, uuid, text) TO anon, authenticated;
