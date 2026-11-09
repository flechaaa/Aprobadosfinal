/* Rename the four Medicina Interna II divisions without changing their IDs. */

UPDATE public.chairs AS c
SET name = CASE public.normalize_taxonomy_key(c.name)
  WHEN '1' THEN 'Hematología'
  WHEN '2' THEN 'Reumatología'
  WHEN '3' THEN 'Endocrinología'
  WHEN '4' THEN 'Nefrología'
END
FROM public.subjects AS s
WHERE c.subject_id = s.id
  AND public.normalize_taxonomy_key(s.name) = public.normalize_taxonomy_key('Medicina Interna II')
  AND public.normalize_taxonomy_key(c.name) IN ('1', '2', '3', '4');

-- Keep denormalized legacy labels aligned with the taxonomy names.
UPDATE public.questions AS q
SET
  subject = s.name,
  chair = c.name
FROM public.chairs AS c
JOIN public.subjects AS s ON s.id = c.subject_id
WHERE q.chair_id = c.id
  AND public.normalize_taxonomy_key(s.name) = public.normalize_taxonomy_key('Medicina Interna II');

UPDATE public.submissions AS submission
SET
  subject = 'Medicina Interna II',
  chair = CASE public.normalize_taxonomy_key(submission.chair)
    WHEN '1' THEN 'Hematología'
    WHEN '2' THEN 'Reumatología'
    WHEN '3' THEN 'Endocrinología'
    WHEN '4' THEN 'Nefrología'
    ELSE submission.chair
  END
WHERE public.normalize_taxonomy_key(submission.subject) = public.normalize_taxonomy_key('Medicina Interna II')
  AND public.normalize_taxonomy_key(submission.chair) IN ('1', '2', '3', '4');