/*
# Clarify the UBA display label

1. Data Changes
- Update the existing Universidad de Buenos Aires taxonomy label to `Universidad de Buenos Aires (UBA)`.
- Preserve the existing university ID and all child subjects and cátedras.

2. Security
- No access policies change.

3. Important Notes
- This is a non-destructive display correction so the selector matches the requested wording exactly.
*/

UPDATE public.universities
SET name = 'Universidad de Buenos Aires (UBA)'
WHERE lower(btrim(name)) = lower('Universidad de Buenos Aires');
