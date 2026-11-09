/*
# Create questions table and admin moderation functions

1. New Tables
- `questions`: stores approved trivia questions extracted from submitted materials.
  - `id` (uuid, primary key, auto-generated)
  - `pregunta` (text, not null) — the question text
  - `opciones` (text[], not null) — array of 4 answer options
  - `correcta` (int, not null, 0-3) — index of the correct option
  - `explicacion` (text, not null) — medical/academic justification
  - `submission_id` (uuid, nullable, references submissions) — source submission
  - `created_at` (timestamptz, defaults to now)

2. Security Functions
- `admin_insert_question`: SECURITY DEFINER function that validates the admin
  password before inserting a question into the `questions` table. Returns the
  new question id.
- `admin_mark_submission_processed`: SECURITY DEFINER function that validates
  the admin password before marking a submission as processed.

3. Security
- Enable RLS on `questions`.
- Allow anon + authenticated to SELECT (game reads questions without sign-in).
- No direct INSERT/UPDATE/DELETE from client; admin operations go through
  SECURITY DEFINER functions that check the password server-side.

4. Important Notes
- This is a no-auth app: the game reads questions as anon.
- Admin operations require the shared admin password, validated server-side.
- The password hash is stored in the function body, not in client code.
*/

CREATE TABLE IF NOT EXISTS public.questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pregunta text NOT NULL CHECK (length(btrim(pregunta)) >= 10),
  opciones text[] NOT NULL CHECK (array_length(opciones, 1) = 4),
  correcta int NOT NULL CHECK (correcta >= 0 AND correcta <= 3),
  explicacion text NOT NULL CHECK (length(btrim(explicacion)) >= 5),
  submission_id uuid REFERENCES public.submissions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS questions_created_at_idx ON public.questions(created_at DESC);

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "questions_select_public" ON public.questions;
CREATE POLICY "questions_select_public" ON public.questions
  FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.admin_insert_question(
  p_pregunta text,
  p_opciones text[],
  p_correcta int,
  p_explicacion text,
  p_submission_id uuid,
  p_admin_password text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
  password_hash constant text := '$2a$06$TR.OpHcmQ4L/Zr1Z3172VesiHIh349LZeOSIcxdmLrdyc05YASRj2';
BEGIN
  IF p_admin_password IS NULL OR length(p_admin_password) > 128 OR extensions.crypt(p_admin_password, password_hash) <> password_hash THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF array_length(p_opciones, 1) <> 4 THEN
    RAISE EXCEPTION 'Se requieren exactamente 4 opciones';
  END IF;
  IF p_correcta < 0 OR p_correcta > 3 THEN
    RAISE EXCEPTION 'El índice de respuesta correcta debe estar entre 0 y 3';
  END IF;

  INSERT INTO public.questions (pregunta, opciones, correcta, explicacion, submission_id)
  VALUES (btrim(p_pregunta), p_opciones, p_correcta, btrim(p_explicacion), p_submission_id)
  RETURNING id INTO v_id;

  RETURN v_id;
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
  SET processed = true
  WHERE id = p_submission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_insert_question(text, text[], int, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_insert_question(text, text[], int, text, uuid, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_mark_submission_processed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_mark_submission_processed(uuid, text) TO anon, authenticated;
