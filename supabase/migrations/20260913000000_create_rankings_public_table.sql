CREATE TABLE IF NOT EXISTS public.rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chair_id uuid NOT NULL REFERENCES public.chairs(id) ON DELETE CASCADE,
  player_name text NOT NULL,
  score integer NOT NULL CHECK (score >= 0),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.rankings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS rankings_chair_score_idx
  ON public.rankings (chair_id, score DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS rankings_chair_created_idx
  ON public.rankings (chair_id, created_at DESC);

ALTER TABLE public.rankings OWNER TO postgres;

DROP POLICY IF EXISTS "rankings_select_public" ON public.rankings;
DROP POLICY IF EXISTS "rankings_insert_public" ON public.rankings;

CREATE POLICY "rankings_select_public"
  ON public.rankings
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "rankings_insert_public"
  ON public.rankings
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

GRANT SELECT, INSERT ON public.rankings TO anon;
GRANT SELECT, INSERT ON public.rankings TO authenticated;
