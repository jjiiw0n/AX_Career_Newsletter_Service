alter table public.subscribers
add column if not exists daily_enabled boolean not null default true;

comment on column public.subscribers.daily_enabled is
'Whether the subscriber receives the daily industry newsletter.';
