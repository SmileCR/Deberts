-- Таблиця онлайн-кімнат Деберц.
-- Виконати один раз у SQL Editor проєкту Supabase.

create table if not exists public.rooms (
  code text primary key,
  name text not null default 'Партія',
  is_public boolean not null default false,
  host_name text not null default 'Гравець',
  state jsonb,
  updated_at timestamptz not null default now(),
  constraint rooms_code_format check (code ~ '^[A-Z0-9]{6}$'),
  constraint rooms_state_size check (state is null or pg_column_size(state) <= 200000)
);

create index if not exists rooms_public_idx on public.rooms (is_public, updated_at desc);

alter table public.rooms enable row level security;

-- Доступ для анонімних клієнтів (публічний ключ у index.html).
-- Гра без облікових записів, тому будь-хто з кодом може читати й змінювати кімнату.
create policy "rooms_select_all" on public.rooms for select to anon, authenticated using (true);
create policy "rooms_insert_all" on public.rooms for insert to anon, authenticated with check (true);
create policy "rooms_update_all" on public.rooms for update to anon, authenticated using (true) with check (true);
create policy "rooms_delete_all" on public.rooms for delete to anon, authenticated using (true);
