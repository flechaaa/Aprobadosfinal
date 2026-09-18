ALTER TABLE IF EXISTS public.submissions
  ALTER COLUMN file_url DROP NOT NULL;

ALTER TABLE IF EXISTS public.submissions
  DROP CONSTRAINT IF EXISTS submissions_material_type_check;

ALTER TABLE IF EXISTS public.submissions
  ADD CONSTRAINT submissions_material_type_check
  CHECK (material_type IN ('apunte', 'preguntero_choice', 'pregunta_respuesta', 'texto'));

ALTER TABLE IF EXISTS public.submissions
  ALTER COLUMN file_type SET DEFAULT 'text/plain';
