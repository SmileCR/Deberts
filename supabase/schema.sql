-- Таблиця онлайн-кімнат Деберц, версія 2 (безпечна).
-- Виконати один раз у SQL Editor проєкту Supabase. Повторний запуск безпечний.

-- 1) Таблиця.
create table if not exists public.rooms (
  code text primary key,
  name text not null default 'Партія',
  is_public boolean not null default false,
  host_name text not null default 'Гравець',
  state jsonb,
  owner_token text,
  updated_at timestamptz not null default now(),
  constraint rooms_code_format check (code ~ '^[A-Z0-9]{6}$'),
  constraint rooms_state_size check (state is null or pg_column_size(state) <= 200000)
);
alter table public.rooms add column if not exists owner_token text;
create index if not exists rooms_public_idx on public.rooms (is_public, updated_at desc);

-- 2) Прибираємо старі відкриті політики.
drop policy if exists rooms_select_all on public.rooms;
drop policy if exists rooms_insert_all on public.rooms;
drop policy if exists rooms_update_all on public.rooms;
drop policy if exists rooms_delete_all on public.rooms;
drop policy if exists rooms_select_public on public.rooms;

alter table public.rooms enable row level security;

-- 3) Анонімні клієнти не мають прямого доступу до таблиці.
revoke all on public.rooms from anon, authenticated;

-- Публічний список: лише публічні кімнати і лише безпечні колонки (без state і owner_token).
create policy rooms_select_public on public.rooms for select to anon, authenticated using (is_public);
grant select (code, name, is_public, host_name, updated_at) on public.rooms to anon, authenticated;

-- 4) Єдині дозволені операції — через функції.

-- Створити кімнату. Токен власника не читається з бази ніколи.
create or replace function public.create_room(p_code text, p_name text, p_public boolean, p_host text, p_state jsonb, p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_code !~ '^[A-Z0-9]{6}$' then raise exception 'bad code'; end if;
  if p_token is null or length(p_token) < 32 then raise exception 'bad token'; end if;
  if p_state is not null and pg_column_size(p_state) > 200000 then raise exception 'state too large'; end if;
  insert into public.rooms (code, name, is_public, host_name, state, owner_token, updated_at)
  values (p_code, left(coalesce(nullif(p_name, ''), 'Партія'), 24), coalesce(p_public, false),
          left(coalesce(nullif(p_host, ''), 'Гравець'), 24), p_state, p_token, now());
end $$;

-- Отримати кімнату за кодом (код = доступ; приватні кімнати не перелічуються).
create or replace function public.get_room(p_code text)
returns table (name text, is_public boolean, state jsonb, updated_at timestamptz)
language sql security definer set search_path = public stable as $$
  select r.name, r.is_public, r.state, r.updated_at from public.rooms r where r.code = p_code;
$$;

-- Зберегти стан кімнати (будь-який учасник, який знає код).
create or replace function public.save_room_state(p_code text, p_state jsonb, p_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_state is null or pg_column_size(p_state) > 200000 then raise exception 'bad state'; end if;
  update public.rooms set state = p_state, updated_at = coalesce(p_at, now()) where code = p_code;
end $$;

-- Закрити кімнату — лише з токеном власника.
create or replace function public.delete_room(p_code text, p_token text)
returns boolean language plpgsql security definer set search_path = public as $$
declare removed boolean;
begin
  with d as (delete from public.rooms where code = p_code and owner_token = p_token returning 1)
  select exists (select 1 from d) into removed;
  return removed;
end $$;

-- Публічний список за останні 6 годин.
create or replace function public.list_public_rooms()
returns table (code text, name text, host_name text, updated_at timestamptz)
language sql security definer set search_path = public stable as $$
  select r.code, r.name, r.host_name, r.updated_at
  from public.rooms r
  where r.is_public and r.updated_at > now() - interval '6 hours'
  order by r.updated_at desc
  limit 30;
$$;

-- 5) Права на функції: лише анонімним клієнтам (ключ у застосунку).
revoke execute on function public.create_room(text, text, boolean, text, jsonb, text) from public;
revoke execute on function public.get_room(text) from public;
revoke execute on function public.save_room_state(text, jsonb, timestamptz) from public;
revoke execute on function public.delete_room(text, text) from public;
revoke execute on function public.list_public_rooms() from public;
grant execute on function public.create_room(text, text, boolean, text, jsonb, text) to anon, authenticated;
grant execute on function public.get_room(text) to anon, authenticated;
grant execute on function public.save_room_state(text, jsonb, timestamptz) to anon, authenticated;
grant execute on function public.delete_room(text, text) to anon, authenticated;
grant execute on function public.list_public_rooms() to anon, authenticated;
