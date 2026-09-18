CREATE OR REPLACE FUNCTION public.admin_update_submission_processing_status(
  p_submission_id uuid,
  p_status text,
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

  IF p_status NOT IN ('procesando', 'procesado', 'error') THEN
    RAISE EXCEPTION 'Invalid processing status';
  END IF;

  UPDATE public.submissions
  SET processing_status = p_status,
      processed = CASE WHEN p_status = 'procesado' THEN true ELSE processed END
  WHERE id = p_submission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_submission_processing_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_submission_processing_status(uuid, text, text) TO anon, authenticated;
