-- Admin mutations used by the moderation panel. Every mutation validates the
-- shared admin credential inside a SECURITY DEFINER function.

CREATE OR REPLACE FUNCTION public.admin_ensure_taxonomy(
  p_university text,
  p_subject text,
  p_chair text,
  p_admin_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  password_hash constant text := '$2a$06$TR.OpHcmQ4L/Zr1Z3172VesiHIh349LZeOSIcxdmLrdyc05YASRj2';
  v_university public.universities%ROWTYPE;
  v_subject public.subjects%ROWTYPE;
  v_chair public.chairs%ROWTYPE;
BEGIN
  IF p_admin_password IS NULL OR length(p_admin_password) > 128 OR extensions.crypt(p_admin_password, password_hash) <> password_hash THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_university FROM public.universities WHERE public.normalize_taxonomy_key(name) = public.normalize_taxonomy_key(p_university) LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.universities (name) VALUES (btrim(p_university)) RETURNING * INTO v_university;
  END IF;

  SELECT * INTO v_subject FROM public.subjects WHERE university_id = v_university.id AND public.normalize_taxonomy_key(name) = public.normalize_taxonomy_key(p_subject) LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.subjects (university_id, name) VALUES (v_university.id, btrim(p_subject)) RETURNING * INTO v_subject;
  END IF;

  SELECT * INTO v_chair FROM public.chairs WHERE subject_id = v_subject.id AND public.normalize_taxonomy_key(name) = public.normalize_taxonomy_key(p_chair) LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.chairs (subject_id, name) VALUES (v_subject.id, btrim(p_chair)) RETURNING * INTO v_chair;
  END IF;

  RETURN jsonb_build_object('university_id', v_university.id, 'subject_id', v_subject.id, 'chair_id', v_chair.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_insert_question_v2(
  p_pregunta text,
  p_opciones text[],
  p_correcta integer,
  p_explicacion text,
  p_submission_id uuid,
  p_subject_id uuid,
  p_chair_id uuid,
  p_university text,
  p_subject text,
  p_chair text,
  p_admin_password text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  password_hash constant text := '$2a$06$TR.OpHcmQ4L/Zr1Z3172VesiHIh349LZeOSIcxdmLrdyc05YASRj2';
  v_id uuid;
BEGIN
  IF p_admin_password IS NULL OR length(p_admin_password) > 128 OR extensions.crypt(p_admin_password, password_hash) <> password_hash THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF btrim(p_pregunta) = '' OR array_length(p_opciones, 1) <> 4 OR p_correcta NOT BETWEEN 0 AND 3 OR length(btrim(p_explicacion)) < 5 THEN
    RAISE EXCEPTION 'Invalid question payload';
  END IF;

  INSERT INTO public.questions (
    pregunta, opciones, correcta, explicacion, submission_id,
    question, options, correct_option, explanation, subject_id, chair_id,
    university, subject, chair, active, is_active, difficulty
  )
  VALUES (
    btrim(p_pregunta), p_opciones, p_correcta, btrim(p_explicacion), p_submission_id,
    btrim(p_pregunta), p_opciones, p_correcta, btrim(p_explicacion), p_subject_id, p_chair_id,
    p_university, p_subject, p_chair, true, true, 'media'
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_approve_question_suggestion(
  p_suggestion_id uuid,
  p_admin_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  password_hash constant text := '$2a$06$TR.OpHcmQ4L/Zr1Z3172VesiHIh349LZeOSIcxdmLrdyc05YASRj2';
  v_suggestion public.question_suggestions%ROWTYPE;
BEGIN
  IF p_admin_password IS NULL OR length(p_admin_password) > 128 OR extensions.crypt(p_admin_password, password_hash) <> password_hash THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO v_suggestion FROM public.question_suggestions WHERE id = p_suggestion_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Suggestion unavailable'; END IF;

  INSERT INTO public.questions (question, options, correct_option, explanation, subject_id, chair_id, active, is_active, difficulty)
  VALUES (v_suggestion.question_text, v_suggestion.options, v_suggestion.correct_option, COALESCE(v_suggestion.explanation, 'Sin explicación disponible.'), v_suggestion.subject_id, v_suggestion.chair_id, true, true, v_suggestion.difficulty);
  UPDATE public.question_suggestions SET status = 'approved' WHERE id = p_suggestion_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reject_question_suggestion(
  p_suggestion_id uuid,
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
  UPDATE public.question_suggestions SET status = 'rejected' WHERE id = p_suggestion_id AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ensure_taxonomy(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_ensure_taxonomy(text, text, text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_insert_question_v2(text, text[], integer, text, uuid, uuid, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_insert_question_v2(text, text[], integer, text, uuid, uuid, uuid, text, text, text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_approve_question_suggestion(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_approve_question_suggestion(uuid, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_reject_question_suggestion(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reject_question_suggestion(uuid, text) TO anon, authenticated;