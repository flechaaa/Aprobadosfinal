-- Extiende public.submissions para el flujo de carga, procesamiento IA y moderación.
-- Las filas anónimas conservan user_id NULL; las sesiones autenticadas pueden asociarse a auth.users.

ALTER TABLE IF EXISTS public.submissions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

ALTER TABLE IF EXISTS public.submissions
  ADD COLUMN IF NOT EXISTS unit text NULL;

ALTER TABLE IF EXISTS public.submissions
  ADD COLUMN IF NOT EXISTS processed_text text NULL;

ALTER TABLE IF EXISTS public.submissions
  ADD COLUMN IF NOT EXISTS processed_question jsonb NULL;

ALTER TABLE IF EXISTS public.submissions
  ADD COLUMN IF NOT EXISTS storage_path text NULL;

ALTER TABLE IF EXISTS public.submissions
  ADD COLUMN IF NOT EXISTS user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.submissions
  DROP CONSTRAINT IF EXISTS submissions_status_check;

ALTER TABLE IF EXISTS public.submissions
  ADD CONSTRAINT submissions_status_check
  CHECK (status IN ('pending', 'processed', 'dismissed'));

UPDATE public.submissions
SET status = CASE
  WHEN processed = true THEN 'processed'
  ELSE 'pending'
END
WHERE status IS NULL OR status NOT IN ('pending', 'processed', 'dismissed');

CREATE INDEX IF NOT EXISTS submissions_status_idx
  ON public.submissions(status);

CREATE INDEX IF NOT EXISTS submissions_user_id_idx
  ON public.submissions(user_id);

CREATE INDEX IF NOT EXISTS submissions_pending_processing_idx
  ON public.submissions(processing_status, created_at DESC);

ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

-- El cliente público puede crear y consultar envíos, pero no modificarlos ni borrarlos.
DROP POLICY IF EXISTS "submissions_select_public" ON public.submissions;
CREATE POLICY "submissions_select_public"
  ON public.submissions
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "submissions_insert_public" ON public.submissions;
CREATE POLICY "submissions_insert_public"
  ON public.submissions
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- Las acciones de moderación deben pasar por funciones SECURITY DEFINER con validación admin.
DROP POLICY IF EXISTS "submissions_update_authenticated_owner" ON public.submissions;
DROP POLICY IF EXISTS "submissions_delete_authenticated_owner" ON public.submissions;

-- El bucket permite lectura y carga pública. La eliminación queda reservada al backend/RPC.
DROP POLICY IF EXISTS "study_materials_public_read" ON storage.objects;
CREATE POLICY "study_materials_public_read"
  ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'study-materials');

DROP POLICY IF EXISTS "study_materials_public_upload" ON storage.objects;
CREATE POLICY "study_materials_public_upload"
  ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'study-materials');

DROP POLICY IF EXISTS "study_materials_public_delete" ON storage.objects;
