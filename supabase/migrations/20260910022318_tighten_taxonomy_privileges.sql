/*
# Tighten taxonomy API privileges

1. Security Changes
- Remove direct public table write access from taxonomy tables and profile records.
- Keep public read access only for approved taxonomy rows.
- Keep public insert access only for new pending proposals.
- Remove direct RPC execution from anonymous callers and restrict moderation execution to signed-in callers.
- Keep the profile creation trigger callable only by the database trigger mechanism, not through the Data API.

2. Important Notes
- Row-level security policies remain the final row-level authorization layer.
- Administrators continue to moderate through the role-checked moderation function.
*/

REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.profiles FROM authenticated;
GRANT SELECT ON public.profiles TO authenticated;

REVOKE ALL ON public.universities FROM anon;
GRANT SELECT ON public.universities TO anon;
REVOKE ALL ON public.universities FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.universities TO authenticated;

REVOKE ALL ON public.subjects FROM anon;
GRANT SELECT ON public.subjects TO anon;
REVOKE ALL ON public.subjects FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subjects TO authenticated;

REVOKE ALL ON public.chairs FROM anon;
GRANT SELECT ON public.chairs TO anon;
REVOKE ALL ON public.chairs FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chairs TO authenticated;

REVOKE ALL ON public.taxonomy_suggestions FROM anon;
GRANT INSERT ON public.taxonomy_suggestions TO anon;
REVOKE ALL ON public.taxonomy_suggestions FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.taxonomy_suggestions TO authenticated;

REVOKE EXECUTE ON FUNCTION public.handle_new_profile() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_profile() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_profile() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.moderate_taxonomy_suggestion(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.moderate_taxonomy_suggestion(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.moderate_taxonomy_suggestion(uuid, text, text) TO authenticated;
