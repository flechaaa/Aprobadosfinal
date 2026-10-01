-- Make material processing retryable and preserve the original submission on AI failures.

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS processing_error text NULL,
  ADD COLUMN IF NOT EXISTS processing_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS extracted_questions jsonb NULL;

ALTER TABLE public.submissions
  DROP CONSTRAINT IF EXISTS submissions_processing_status_check;

ALTER TABLE public.submissions
  ADD CONSTRAINT submissions_processing_status_check
  CHECK (processing_status IN ('pendiente_procesamiento', 'procesando', 'procesado', 'error', 'error_tokens'));

CREATE INDEX IF NOT EXISTS submissions_processing_queue_idx
  ON public.submissions(processing_status, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_retry_submission_processing(
  p_submission_id uuid,
  p_admin_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  password_hash constant text := '$2a$06$TR.OpHcmQ4L/Zr1Z3172VesiHIh349LZeOSIcxdmLrdyc05YASRj2';
BEGIN
  IF p_admin_password IS NULL OR length(p_admin_password) > 128 OR extensions.crypt(p_admin_password, password_hash) <> password_hash THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.submissions
  SET status = 'pending',
      processed = false,
      processing_status = 'pendiente_procesamiento',
      processing_error = NULL,
      processing_started_at = NULL
  WHERE id = p_submission_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_store_submission_processing_result(
  p_submission_id uuid,
  p_extracted_questions jsonb,
  p_processed_text text,
  p_processing_status text,
  p_processing_error text,
  p_admin_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  password_hash constant text := '$2a$06$TR.OpHcmQ4L/Zr1Z3172VesiHIh349LZeOSIcxdmLrdyc05YASRj2';
BEGIN
  IF p_admin_password IS NULL OR length(p_admin_password) > 128 OR extensions.crypt(p_admin_password, password_hash) <> password_hash THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_processing_status NOT IN ('procesado', 'error', 'error_tokens', 'pendiente_procesamiento') THEN
    RAISE EXCEPTION 'Invalid processing status';
  END IF;

  UPDATE public.submissions
  SET extracted_questions = COALESCE(p_extracted_questions, extracted_questions),
      processed_text = COALESCE(NULLIF(p_processed_text, ''), processed_text),
      processing_status = p_processing_status,
      processing_error = NULLIF(p_processing_error, ''),
      processed = p_processing_status = 'procesado',
      processed_at = CASE WHEN p_processing_status = 'procesado' THEN now() ELSE processed_at END
  WHERE id = p_submission_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_mark_submission_processed(
  p_submission_id uuid,
  p_admin_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  password_hash constant text := '$2a$06$TR.OpHcmQ4L/Zr1Z3172VesiHIh349LZeOSIcxdmLrdyc05YASRj2';
BEGIN
  IF p_admin_password IS NULL OR length(p_admin_password) > 128 OR extensions.crypt(p_admin_password, password_hash) <> password_hash THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.submissions
  SET status = 'processed',
      processed = true,
      processing_status = 'procesado',
      processing_error = NULL,
      processed_at = now()
  WHERE id = p_submission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_retry_submission_processing(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_retry_submission_processing(uuid, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_store_submission_processing_result(uuid, jsonb, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_store_submission_processing_result(uuid, jsonb, text, text, text, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_mark_submission_processed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_mark_submission_processed(uuid, text) TO anon, authenticated;