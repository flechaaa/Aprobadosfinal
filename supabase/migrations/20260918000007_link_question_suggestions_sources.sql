ALTER TABLE IF EXISTS public.question_suggestions
  ADD COLUMN IF NOT EXISTS source_submission_id uuid NULL REFERENCES public.submissions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_file_url text NULL,
  ADD COLUMN IF NOT EXISTS source_storage_path text NULL;

CREATE INDEX IF NOT EXISTS question_suggestions_source_submission_idx
  ON public.question_suggestions(source_submission_id);

CREATE OR REPLACE FUNCTION public.admin_delete_submission(
  p_submission_id uuid,
  p_storage_path text,
  p_admin_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, storage, extensions
AS $$
DECLARE
  password_hash constant text := '$2a$06$TR.OpHcmQ4L/Zr1Z3172VesiHIh349LZeOSIcxdmLrdyc05YASRj2';
BEGIN
  IF p_admin_password IS NULL OR length(p_admin_password) > 128 OR extensions.crypt(p_admin_password, password_hash) <> password_hash THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF nullif(btrim(p_storage_path), '') IS NOT NULL THEN
    DELETE FROM storage.objects
    WHERE bucket_id = 'study-materials' AND name = btrim(p_storage_path);
  END IF;

  DELETE FROM public.submissions WHERE id = p_submission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_submission(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_submission(uuid, text, text) TO anon, authenticated;
