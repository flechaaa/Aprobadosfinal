/*
# Limpieza real de filas de taxonomía existentes

Este ajuste aplica la clave canónica del proyecto a filas ya persistidas,
normaliza el nombre visible y deduplica universidades, materias y cátedras
por la clave de comparación sin acentos ni signos.
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

    IF key IN (
      'uba',
      'u b a',
      'u b a universidad de buenos aires',
      'universidad de buenos aires',
      'universidad nacional de buenos aires',
      'universidad de buenos aires uba'
    ) THEN
      RETURN 'Universidad de Buenos Aires';
    END IF;
  END IF;

  IF level = 'subject' THEN
    RETURN trim(regexp_replace(input, '\s+', ' ', 'g'));
  END IF;

  IF level = 'chair' THEN
    RETURN trim(regexp_replace(input, '\s+', ' ', 'g'));
  END IF;

  RETURN trim(regexp_replace(input, '\s+', ' ', 'g'));
END;
$$;

-- 1) Normalizar nombres escritos en la base hacia una forma canónica visible.
UPDATE public.universities
SET name = public.canonicalize_taxonomy_name('university', name);

UPDATE public.subjects
SET name = public.canonicalize_taxonomy_name('subject', name);

UPDATE public.chairs
SET name = public.canonicalize_taxonomy_name('chair', name);

-- 2) Deduplicar universidades por clave normalizada.
CREATE TEMP TABLE university_keep_map AS
SELECT min(id) AS keeper_id, public.normalize_taxonomy_key(name) AS key
FROM public.universities
GROUP BY public.normalize_taxonomy_key(name);

CREATE TEMP TABLE university_dup_map AS
SELECT u.id AS duplicate_id, km.keeper_id
FROM public.universities u
JOIN university_keep_map km
  ON km.key = public.normalize_taxonomy_key(u.name)
WHERE u.id <> km.keeper_id;

UPDATE public.subjects s
SET university_id = m.keeper_id
FROM university_dup_map m
WHERE s.university_id = m.duplicate_id;

DELETE FROM public.universities u
WHERE u.id IN (SELECT duplicate_id FROM university_dup_map);

DROP TABLE IF EXISTS university_keep_map;
DROP TABLE IF EXISTS university_dup_map;

-- 3) Deduplicar materias por universidad y clave normalizada.
CREATE TEMP TABLE subject_keep_map AS
SELECT min(id) AS keeper_id, university_id, public.normalize_taxonomy_key(name) AS key
FROM public.subjects
GROUP BY university_id, public.normalize_taxonomy_key(name);

CREATE TEMP TABLE subject_dup_map AS
SELECT s.id AS duplicate_id, km.keeper_id
FROM public.subjects s
JOIN subject_keep_map km
  ON km.university_id = s.university_id
 AND km.key = public.normalize_taxonomy_key(s.name)
WHERE s.id <> km.keeper_id;

UPDATE public.chairs c
SET subject_id = m.keeper_id
FROM subject_dup_map m
WHERE c.subject_id = m.duplicate_id;

DELETE FROM public.subjects s
WHERE s.id IN (SELECT duplicate_id FROM subject_dup_map);

DROP TABLE IF EXISTS subject_keep_map;
DROP TABLE IF EXISTS subject_dup_map;

-- 4) Deduplicar cátedras por materia y clave normalizada.
CREATE TEMP TABLE chair_keep_map AS
SELECT min(id) AS keeper_id, subject_id, public.normalize_taxonomy_key(name) AS key
FROM public.chairs
GROUP BY subject_id, public.normalize_taxonomy_key(name);

CREATE TEMP TABLE chair_dup_map AS
SELECT c.id AS duplicate_id, km.keeper_id
FROM public.chairs c
JOIN chair_keep_map km
  ON km.subject_id = c.subject_id
 AND km.key = public.normalize_taxonomy_key(c.name)
WHERE c.id <> km.keeper_id;

DELETE FROM public.chairs c
WHERE c.id IN (SELECT duplicate_id FROM chair_dup_map);

DROP TABLE IF EXISTS chair_keep_map;
DROP TABLE IF EXISTS chair_dup_map;
