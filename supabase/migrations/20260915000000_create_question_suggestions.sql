create table if not exists public.question_suggestions (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete restrict,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  chair_id uuid not null references public.chairs(id) on delete restrict,
  question_text text not null,
  options text[] not null,
  correct_option integer not null check (correct_option >= 0),
  explanation text null,
  difficulty text not null default 'media' check (difficulty in ('facil', 'media', 'dificil')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.question_suggestions enable row level security;

create policy "question_suggestions_public_insert"
on public.question_suggestions
for insert
to public
with check (true);

create policy "question_suggestions_public_select"
on public.question_suggestions
for select
to public
using (true);

create policy "question_suggestions_public_update_admin_only"
on public.question_suggestions
for update
to public
using (false)
with check (false);

create policy "question_suggestions_public_delete_admin_only"
on public.question_suggestions
for delete
to public
using (false);
