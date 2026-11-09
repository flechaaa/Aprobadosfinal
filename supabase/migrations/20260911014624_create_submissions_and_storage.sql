/*
# Create submissions table and study-materials storage bucket

1. New Tables
- `submissions`: stores user-contributed study materials.
  - `id` (uuid, primary key, auto-generated)
  - `created_at` (timestamptz, defaults to now)
  - `university` (text, not null) — university name at time of submission
  - `subject` (text, not null) — subject name
  - `chair` (text, not null) — chair or teacher name
  - `source_notes` (text, nullable) — optional notes or source year
  - `material_type` (text, not null) — one of: 'apunte', 'preguntero_choice', 'pregunta_respuesta'
  - `file_url` (text, not null) — public URL of the uploaded file in storage
  - `file_type` (text, not null) — MIME type of the uploaded file
  - `processed` (boolean, default false) — admin review flag

2. Storage
- Create bucket `study-materials` for file uploads.
- Set bucket to public so uploaded files can be accessed via public URL.
- Add storage policies allowing anon + authenticated to upload, and anyone to read.

3. Security
- Enable RLS on `submissions`.
- Allow anon + authenticated to INSERT (public submission, no sign-in required).
- Allow anon + authenticated to SELECT (submissions are public).
- No UPDATE or DELETE from the client; admin processing happens server-side.

4. Important Notes
- This is a no-auth app: anyone can submit material without signing in.
- File size and type validation is enforced client-side; storage policies allow the accepted types.
- The `processed` column defaults to false and is not client-writable.
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('study-materials', 'study-materials', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "study_materials_public_read" ON storage.objects;
CREATE POLICY "study_materials_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'study-materials');

DROP POLICY IF EXISTS "study_materials_public_upload" ON storage.objects;
CREATE POLICY "study_materials_public_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'study-materials');

CREATE TABLE IF NOT EXISTS public.submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  university text NOT NULL CHECK (length(btrim(university)) BETWEEN 2 AND 200),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 2 AND 200),
  chair text NOT NULL CHECK (length(btrim(chair)) BETWEEN 2 AND 200),
  source_notes text,
  material_type text NOT NULL CHECK (material_type IN ('apunte', 'preguntero_choice', 'pregunta_respuesta')),
  file_url text NOT NULL,
  file_type text NOT NULL,
  processed boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS submissions_created_at_idx ON public.submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_material_type_idx ON public.submissions(material_type);

ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "submissions_select_public" ON public.submissions;
CREATE POLICY "submissions_select_public" ON public.submissions
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "submissions_insert_public" ON public.submissions;
CREATE POLICY "submissions_insert_public" ON public.submissions
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);
