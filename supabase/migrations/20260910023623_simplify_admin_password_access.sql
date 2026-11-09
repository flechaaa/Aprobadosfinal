/*
# Simplify admin access to a server-checked password

1. Security Changes
- Add password-protected RPCs for loading pending taxonomy proposals and moderating them.
- Store only a bcrypt hash of the requested administrator password in the database function body; the password is never shipped in the browser bundle.
- Keep the existing authenticated moderation function available for compatibility, while the new password-gated functions are used by the simplified panel.
- Restrict the new RPCs to `anon` and `authenticated` because the panel no longer requires an email account; each function validates the password before returning or changing anything.

2. Important Notes
- The browser sends the entered password only over the Supabase HTTPS connection and does not persist it.
- This is intentionally a simple shared-password gate. Anyone who knows the password can moderate content, so it should be changed in a future deployment if the panel becomes public or the administrator group grows.
- All moderation authorization is enforced inside PostgreSQL rather than by a client-only boolean.
*/

CREATE OR REPLACE FUNCTION public.admin_list_taxonomy_suggestions(p_admin_password text)
RETURNS SETOF public.taxonomy_suggestions
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  password_hash constant text := '$2a$06$TR.OpHcmQ4L/Zr1Z3172VesiHIh349LZeOSIcxdmLrdyc05YASRj2';
BEGIN
  IF p_admin_password IS NULL OR length(p_admin_password) > 128 OR extensions.crypt(p_admin_password, password_hash) <> password_hash THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.taxonomy_suggestions
  WHERE status = 'pending'
  ORDER BY created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_moderate_taxonomy_suggestion(
  p_suggestion uuid,
  p_action text,
  p_name text,
  p_admin_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_suggestion public.taxonomy_suggestions%ROWTYPE;
  v_name text;
  password_hash constant text := '$2a$06$TR.OpHcmQ4L/Zr1Z3172VesiHIh349LZeOSIcxdmLrdyc05YASRj2';
BEGIN
  IF p_admin_password IS NULL OR length(p_admin_password) > 128 OR extensions.crypt(p_admin_password, password_hash) <> password_hash THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_suggestion
  FROM public.taxonomy_suggestions
  WHERE id = p_suggestion AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Suggestion unavailable'; END IF;

  v_name := btrim(COALESCE(NULLIF(p_name, ''), v_suggestion.proposed_name));
  IF length(v_name) < 2 OR length(v_name) > 120 THEN RAISE EXCEPTION 'Invalid name'; END IF;

  IF p_action = 'reject' THEN
    UPDATE public.taxonomy_suggestions
    SET status = 'rejected', reviewed_at = now()
    WHERE id = p_suggestion;
  ELSIF p_action = 'approve' THEN
    IF v_suggestion.level = 'university' THEN
      INSERT INTO public.universities (name) VALUES (v_name) ON CONFLICT DO NOTHING;
    ELSIF v_suggestion.level = 'subject' THEN
      INSERT INTO public.subjects (university_id, name) VALUES (v_suggestion.university_id, v_name) ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO public.chairs (subject_id, name) VALUES (v_suggestion.subject_id, v_name) ON CONFLICT DO NOTHING;
    END IF;

    UPDATE public.taxonomy_suggestions
    SET status = 'approved', proposed_name = v_name, reviewed_at = now()
    WHERE id = p_suggestion;
  ELSE
    RAISE EXCEPTION 'Invalid action';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_taxonomy_suggestions(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_taxonomy_suggestions(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_moderate_taxonomy_suggestion(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_moderate_taxonomy_suggestion(uuid, text, text, text) TO anon, authenticated;
