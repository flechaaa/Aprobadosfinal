/*
# Normalizar nombres de taxonomía en SQL

Este ajuste aporta una clave canónica para universidades, materias y cátedras
usando un solo normalizador expresado en SQL. El objetivo es que:
- mayúsculas, tildes, signos y espacios extras no importen,
- variantes como "Fundación Barceló" y "fundacion barcelo" hagan match
  con una sola identidad mediante la misma clave canónica.
*/

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.normalize_taxonomy_key(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(
    regexp_replace(
      regexp_replace(
        unaccent(lower(btrim(coalesce(input, '')))),
        '[^a-z0-9]+',
        ' ',
        'g'
      ),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.canonicalize_taxonomy_name(level text, input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  key text;
BEGIN
  key := public.normalize_taxonomy_key(input);

  IF level = 'university' THEN
    IF key LIKE '%barcelo%' THEN
      RETURN 'Fundación Barceló';
    END IF;

    IF key IN ('uba', 'u b a', 'u b a universidad de buenos aires', 'universidad de buenos aires', 'universidad nacional de buenos aires', 'universidad de buenos aires uba') THEN
      RETURN 'Universidad de Buenos Aires';
    END IF;
  END IF;

  RETURN trim(regexp_replace(input, '\s+', ' ', 'g'));
END;
$$;

DROP INDEX IF EXISTS universities_name_lower_key;
DROP INDEX IF EXISTS subjects_university_name_lower_key;
DROP INDEX IF EXISTS chairs_subject_name_lower_key;

CREATE UNIQUE INDEX IF NOT EXISTS universities_name_normalized_key
  ON public.universities (public.normalize_taxonomy_key(name));

CREATE UNIQUE INDEX IF NOT EXISTS subjects_university_name_normalized_key
  ON public.subjects (university_id, public.normalize_taxonomy_key(name));

CREATE UNIQUE INDEX IF NOT EXISTS chairs_subject_name_normalized_key
  ON public.chairs (subject_id, public.normalize_taxonomy_key(name));

CREATE OR REPLACE FUNCTION public.moderate_taxonomy_suggestion(
  p_suggestion uuid,
  p_action text,
  p_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_suggestion public.taxonomy_suggestions%ROWTYPE;
  v_name text;
  v_safe_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_suggestion FROM public.taxonomy_suggestions WHERE id = p_suggestion AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Suggestion unavailable';
  END IF;

  v_name := btrim(COALESCE(NULLIF(p_name, ''), v_suggestion.proposed_name));
  IF length(v_name) < 2 OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'Invalid name';
  END IF;

  v_safe_name := public.canonicalize_taxonomy_name(v_suggestion.level, v_name);

  IF p_action = 'reject' THEN
    UPDATE public.taxonomy_suggestions
      SET status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid()
      WHERE id = p_suggestion;
  ELSIF p_action = 'approve' THEN
    IF v_suggestion.level = 'university' THEN
      INSERT INTO public.universities (name)
      VALUES (v_safe_name)
      ON CONFLICT (public.normalize_taxonomy_key(name)) DO NOTHING;
    ELSIF v_suggestion.level = 'subject' THEN
      INSERT INTO public.subjects (university_id, name)
      VALUES (v_suggestion.university_id, v_safe_name)
      ON CONFLICT (university_id, public.normalize_taxonomy_key(name)) DO NOTHING;
    ELSE
      INSERT INTO public.chairs (subject_id, name)
      VALUES (v_suggestion.subject_id, v_safe_name)
      ON CONFLICT (subject_id, public.normalize_taxonomy_key(name)) DO NOTHING;
    END IF;

    UPDATE public.taxonomy_suggestions
      SET status = 'approved', proposed_name = v_safe_name, reviewed_at = now(), reviewed_by = auth.uid()
      WHERE id = p_suggestion;
  ELSE
    RAISE EXCEPTION 'Invalid action';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.moderate_taxonomy_suggestion(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.moderate_taxonomy_suggestion(uuid, text, text) TO authenticated;
