CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NULL,
  auth text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS session_id text NULL;

CREATE INDEX IF NOT EXISTS user_subscriptions_session_id_idx ON public.user_subscriptions(session_id);
