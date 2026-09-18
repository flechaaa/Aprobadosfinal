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
  SET processed = true,
      processing_status = 'procesado'
  WHERE id = p_submission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_mark_submission_processed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_mark_submission_processed(uuid, text) TO anon, authenticated;
