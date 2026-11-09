/*
# Correct default university, subject, and cátedra distribution

1. Data Changes
- Add `Fundación Barceló` as an approved university.
- Add `Infectología` and `Pediatría` under Fundación Barceló.
- Add `Cátedra Hospital Muñiz` under Fundación Barceló / Infectología.
- Add `Cátedra Hospital Fernández` under Fundación Barceló / Pediatría.
- Add `Pediatría` under Universidad de Buenos Aires (UBA).
- Rename the existing UBA / Infectología `Cátedra Única` record to `Cátedra 1` so existing references are preserved.
- Add `Cátedra 2` under Universidad de Buenos Aires (UBA) / Infectología.
- Add `Cátedra Única` under Universidad de Buenos Aires (UBA) / Pediatría.

2. Security
- No access policies are changed. Existing row-level security and administrator-only write rules remain in force.

3. Important Notes
- The update is idempotent and uses existing parent records by name instead of hardcoding generated IDs.
- Existing taxonomy rows are preserved; the one conflicting UBA Infectología cátedra is corrected by renaming rather than deleting it.
- The cascading selectors already read this approved taxonomy, so the exact distribution appears automatically after the data update.
*/

INSERT INTO public.universities (name)
VALUES ('Fundación Barceló')
ON CONFLICT DO NOTHING;

INSERT INTO public.subjects (university_id, name)
SELECT u.id, values_table.name
FROM public.universities u
CROSS JOIN (VALUES ('Infectología'), ('Pediatría')) AS values_table(name)
WHERE lower(btrim(u.name)) = lower('Fundación Barceló')
ON CONFLICT DO NOTHING;

INSERT INTO public.subjects (university_id, name)
SELECT u.id, 'Pediatría'
FROM public.universities u
WHERE lower(btrim(u.name)) = lower('Universidad de Buenos Aires')
ON CONFLICT DO NOTHING;

UPDATE public.chairs c
SET name = 'Cátedra 1'
FROM public.subjects s
JOIN public.universities u ON u.id = s.university_id
WHERE c.subject_id = s.id
  AND lower(btrim(u.name)) = lower('Universidad de Buenos Aires')
  AND lower(btrim(s.name)) = lower('Infectología')
  AND lower(btrim(c.name)) = lower('Cátedra Única');

INSERT INTO public.chairs (subject_id, name)
SELECT s.id, values_table.name
FROM public.subjects s
JOIN public.universities u ON u.id = s.university_id
CROSS JOIN (VALUES ('Cátedra 1'), ('Cátedra 2')) AS values_table(name)
WHERE lower(btrim(u.name)) = lower('Universidad de Buenos Aires')
  AND lower(btrim(s.name)) = lower('Infectología')
ON CONFLICT DO NOTHING;

INSERT INTO public.chairs (subject_id, name)
SELECT s.id, 'Cátedra Única'
FROM public.subjects s
JOIN public.universities u ON u.id = s.university_id
WHERE lower(btrim(u.name)) = lower('Universidad de Buenos Aires')
  AND lower(btrim(s.name)) = lower('Pediatría')
ON CONFLICT DO NOTHING;

INSERT INTO public.chairs (subject_id, name)
SELECT s.id, values_table.name
FROM public.subjects s
JOIN public.universities u ON u.id = s.university_id
CROSS JOIN (VALUES ('Cátedra Hospital Muñiz'), ('Cátedra Hospital Fernández')) AS values_table(name)
WHERE lower(btrim(u.name)) = lower('Fundación Barceló')
  AND (
    (lower(btrim(s.name)) = lower('Infectología') AND values_table.name = 'Cátedra Hospital Muñiz')
    OR (lower(btrim(s.name)) = lower('Pediatría') AND values_table.name = 'Cátedra Hospital Fernández')
  )
ON CONFLICT DO NOTHING;
