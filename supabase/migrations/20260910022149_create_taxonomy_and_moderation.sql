/*
# Add a three-level taxonomy and protected moderation workflow

1. New Tables
- `profiles`: links signed-in users to a moderation role; new accounts start as `member`.
- `universities`: approved top-level university names.
- `subjects`: approved subjects belonging to a university.
- `chairs`: approved cátedra names belonging to a subject.
- `taxonomy_suggestions`: public proposals awaiting moderation, with the level and parent context.

2. Security
- Row-level security is enabled on every new table.
- Published taxonomy rows can be read publicly, but only administrators can change them.
- Anyone may submit a proposal, while pending proposals are visible only to administrators.
- Moderation writes happen through `moderate_taxonomy_suggestion`, a SECURITY DEFINER function that verifies the caller's administrator role.
- Profile roles are never client-writable.

3. Important Notes
- The existing question bank remains unchanged; the taxonomy is stored separately so questions can be categorized without losing the current content.
- The first account created is a regular member. An operator must promote an account to `admin` in the protected database environment before using the moderation controls.
- Approved names are canonicalized by unique, case-insensitive indexes within their parent level to prevent duplicate variants.
*/

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.universities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid NOT NULL REFERENCES public.universities(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.taxonomy_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level text NOT NULL CHECK (level IN ('university', 'subject', 'chair')),
  proposed_name text NOT NULL CHECK (length(btrim(proposed_name)) BETWEEN 2 AND 120),
  university_id uuid REFERENCES public.universities(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT taxonomy_suggestions_parent_check CHECK (
    (level = 'university' AND university_id IS NULL AND subject_id IS NULL)
    OR (level = 'subject' AND university_id IS NOT NULL AND subject_id IS NULL)
    OR (level = 'chair' AND university_id IS NULL AND subject_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS subjects_university_id_idx ON public.subjects(university_id);
CREATE INDEX IF NOT EXISTS chairs_subject_id_idx ON public.chairs(subject_id);
CREATE INDEX IF NOT EXISTS taxonomy_suggestions_status_idx ON public.taxonomy_suggestions(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS universities_name_lower_key ON public.universities(lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS subjects_university_name_lower_key ON public.subjects(university_id, lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS chairs_subject_name_lower_key ON public.chairs(subject_id, lower(btrim(name)));

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.universities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxonomy_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_self" ON public.profiles;
CREATE POLICY "profiles_select_self" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_insert_self" ON public.profiles;
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id AND role = 'member');
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id AND role = 'member') WITH CHECK (auth.uid() = id AND role = 'member');
DROP POLICY IF EXISTS "profiles_delete_self" ON public.profiles;
CREATE POLICY "profiles_delete_self" ON public.profiles FOR DELETE TO authenticated USING (auth.uid() = id AND role = 'member');

DROP POLICY IF EXISTS "universities_select_published" ON public.universities;
CREATE POLICY "universities_select_published" ON public.universities FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "universities_insert_admin" ON public.universities;
CREATE POLICY "universities_insert_admin" ON public.universities FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "universities_update_admin" ON public.universities;
CREATE POLICY "universities_update_admin" ON public.universities FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "universities_delete_admin" ON public.universities;
CREATE POLICY "universities_delete_admin" ON public.universities FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "subjects_select_published" ON public.subjects;
CREATE POLICY "subjects_select_published" ON public.subjects FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "subjects_insert_admin" ON public.subjects;
CREATE POLICY "subjects_insert_admin" ON public.subjects FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "subjects_update_admin" ON public.subjects;
CREATE POLICY "subjects_update_admin" ON public.subjects FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "subjects_delete_admin" ON public.subjects;
CREATE POLICY "subjects_delete_admin" ON public.subjects FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "chairs_select_published" ON public.chairs;
CREATE POLICY "chairs_select_published" ON public.chairs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "chairs_insert_admin" ON public.chairs;
CREATE POLICY "chairs_insert_admin" ON public.chairs FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "chairs_update_admin" ON public.chairs;
CREATE POLICY "chairs_update_admin" ON public.chairs FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "chairs_delete_admin" ON public.chairs;
CREATE POLICY "chairs_delete_admin" ON public.chairs FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "suggestions_select_admin" ON public.taxonomy_suggestions;
CREATE POLICY "suggestions_select_admin" ON public.taxonomy_suggestions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "suggestions_insert_public" ON public.taxonomy_suggestions;
CREATE POLICY "suggestions_insert_public" ON public.taxonomy_suggestions FOR INSERT TO anon, authenticated WITH CHECK (status = 'pending' AND reviewed_at IS NULL AND reviewed_by IS NULL);
DROP POLICY IF EXISTS "suggestions_update_admin" ON public.taxonomy_suggestions;
CREATE POLICY "suggestions_update_admin" ON public.taxonomy_suggestions FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "suggestions_delete_admin" ON public.taxonomy_suggestions;
CREATE POLICY "suggestions_delete_admin" ON public.taxonomy_suggestions FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (new.id) ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile();

CREATE OR REPLACE FUNCTION public.moderate_taxonomy_suggestion(
  p_suggestion uuid,
  p_action text,
  p_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_suggestion public.taxonomy_suggestions%ROWTYPE;
  v_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_suggestion FROM public.taxonomy_suggestions WHERE id = p_suggestion AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Suggestion unavailable'; END IF;

  v_name := btrim(COALESCE(NULLIF(p_name, ''), v_suggestion.proposed_name));
  IF length(v_name) < 2 OR length(v_name) > 120 THEN RAISE EXCEPTION 'Invalid name'; END IF;

  IF p_action = 'reject' THEN
    UPDATE public.taxonomy_suggestions SET status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid() WHERE id = p_suggestion;
  ELSIF p_action = 'approve' THEN
    IF v_suggestion.level = 'university' THEN
      INSERT INTO public.universities (name) VALUES (v_name) ON CONFLICT DO NOTHING;
    ELSIF v_suggestion.level = 'subject' THEN
      INSERT INTO public.subjects (university_id, name) VALUES (v_suggestion.university_id, v_name) ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO public.chairs (subject_id, name) VALUES (v_suggestion.subject_id, v_name) ON CONFLICT DO NOTHING;
    END IF;
    UPDATE public.taxonomy_suggestions SET status = 'approved', proposed_name = v_name, reviewed_at = now(), reviewed_by = auth.uid() WHERE id = p_suggestion;
  ELSE
    RAISE EXCEPTION 'Invalid action';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.moderate_taxonomy_suggestion(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.moderate_taxonomy_suggestion(uuid, text, text) TO authenticated;

INSERT INTO public.universities (name) VALUES ('Universidad de Buenos Aires') ON CONFLICT DO NOTHING;
INSERT INTO public.subjects (university_id, name)
SELECT id, 'Infectología' FROM public.universities WHERE lower(name) = lower('Universidad de Buenos Aires')
ON CONFLICT DO NOTHING;
INSERT INTO public.chairs (subject_id, name)
SELECT s.id, 'Cátedra Única' FROM public.subjects s JOIN public.universities u ON u.id = s.university_id
WHERE lower(u.name) = lower('Universidad de Buenos Aires') AND lower(s.name) = lower('Infectología')
ON CONFLICT DO NOTHING;
