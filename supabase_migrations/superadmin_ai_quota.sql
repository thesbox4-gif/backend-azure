-- Super admin role + Gemini AI quota tracking
-- Run in Supabase SQL Editor after main schema

-- Extend user_role enum
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    where t.typname = 'user_role' and e.enumlabel = 'superadmin'
  ) then
    alter type user_role add value 'superadmin';
  end if;
end $$;

-- Singleton quota settings
create table if not exists ai_quota_settings (
  id             int primary key default 1 check (id = 1),
  image_limit    int not null default 500,
  content_limit  int not null default 2000,
  reset_period   text not null default 'monthly' check (reset_period in ('lifetime', 'monthly')),
  period_start   timestamptz not null default date_trunc('month', now()),
  images_used    int not null default 0 check (images_used >= 0),
  content_used   int not null default 0 check (content_used >= 0),
  updated_at     timestamptz default now(),
  updated_by     uuid references profiles(id) on delete set null
);

insert into ai_quota_settings (id) values (1) on conflict (id) do nothing;

-- Usage audit log
create table if not exists ai_usage_log (
  id          uuid primary key default gen_random_uuid(),
  usage_type  text not null check (usage_type in ('image', 'content')),
  user_id     uuid references profiles(id) on delete set null,
  created_at  timestamptz default now()
);

create index if not exists idx_ai_usage_log_type on ai_usage_log(usage_type);
create index if not exists idx_ai_usage_log_created on ai_usage_log(created_at desc);

-- Reset monthly counters when period rolls over (returns true if reset happened)
create or replace function maybe_reset_ai_quota_period()
returns void as $$
begin
  update ai_quota_settings
  set
    images_used = 0,
    content_used = 0,
    period_start = date_trunc('month', now()),
    updated_at = now()
  where id = 1
    and reset_period = 'monthly'
    and date_trunc('month', period_start) < date_trunc('month', now());
end;
$$ language plpgsql security definer;

-- Atomically consume one quota unit; raises exception if limit reached
create or replace function consume_ai_quota(p_type text, p_user_id uuid default null)
returns jsonb as $$
declare
  s ai_quota_settings%rowtype;
  remaining int;
begin
  if p_type not in ('image', 'content') then
    raise exception 'Invalid usage type';
  end if;

  perform maybe_reset_ai_quota_period();

  select * into s from ai_quota_settings where id = 1 for update;
  if not found then
    raise exception 'AI quota settings not configured';
  end if;

  if p_type = 'image' then
    if s.images_used >= s.image_limit then
      raise exception 'AI image quota exhausted';
    end if;
    update ai_quota_settings
    set images_used = images_used + 1, updated_at = now()
    where id = 1;
    remaining := s.image_limit - s.images_used - 1;
  else
    if s.content_used >= s.content_limit then
      raise exception 'AI content quota exhausted';
    end if;
    update ai_quota_settings
    set content_used = content_used + 1, updated_at = now()
    where id = 1;
    remaining := s.content_limit - s.content_used - 1;
  end if;

  insert into ai_usage_log (usage_type, user_id) values (p_type, p_user_id);

  return jsonb_build_object('type', p_type, 'remaining', remaining);
end;
$$ language plpgsql security definer;

-- Manual period reset (super admin)
create or replace function reset_ai_quota_period()
returns void as $$
begin
  update ai_quota_settings
  set
    images_used = 0,
    content_used = 0,
    period_start = case
      when reset_period = 'monthly' then date_trunc('month', now())
      else period_start
    end,
    updated_at = now()
  where id = 1;
end;
$$ language plpgsql security definer;
