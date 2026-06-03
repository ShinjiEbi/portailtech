-- =====================================================================
-- Portail-tech V2 - schma Supabase (Postgres)
--  excuter UNE fois dans Supabase > SQL Editor.
-- =====================================================================

-- ---------- PROFILES ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nom text,
  site text,
  role text not null default 'tech' check (role in ('tech','referent','admin')),
  updated_at timestamptz not null default now()
);

-- ---------- ETALONS (ECME) - base commune partage ----------
create table if not exists public.etalons (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'autre',
  designation text not null,
  marque text,
  modele text,
  num_serie text,
  identifiant text,
  date_etalonnage date,
  date_echeance date,
  certificat_ref text,
  certificat_url text,
  raccordement_cofrac boolean default false,
  site text,
  localisation text,
  statut text not null default 'en_service',
  caracteristiques jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

-- ---------- IMPUTATIONS - perso (par user_id) ----------
create table if not exists public.imputations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  site text,
  code_affaire text,
  heures numeric(6,2),
  activite text,
  commentaire text,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

-- ---------- JOURNAL - main courante partage ----------
create table if not exists public.journal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ts timestamptz not null default now(),
  type text,
  site text,
  contenu text,
  etalon_id uuid references public.etalons(id) on delete set null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

-- ---------- index (curseur de synchro + requtes perso) ----------
create index if not exists idx_etalons_updated on public.etalons(updated_at);
create index if not exists idx_imputations_updated on public.imputations(updated_at);
create index if not exists idx_imputations_user on public.imputations(user_id, date);
create index if not exists idx_journal_updated on public.journal(updated_at);
create index if not exists idx_journal_user on public.journal(user_id);

-- ---------- updated_at automatique ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists t_profiles_upd on public.profiles;
create trigger t_profiles_upd before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists t_etalons_upd on public.etalons;
create trigger t_etalons_upd before update on public.etalons
  for each row execute function public.set_updated_at();

drop trigger if exists t_imputations_upd on public.imputations;
create trigger t_imputations_upd before update on public.imputations
  for each row execute function public.set_updated_at();

drop trigger if exists t_journal_upd on public.journal;
create trigger t_journal_upd before update on public.journal
  for each row execute function public.set_updated_at();

-- ---------- cration auto du profil  l'inscription ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nom) values (new.id, new.email);
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- helper rle (security definer : vite la rcursion RLS) ----------
create or replace function public.is_referent()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('referent','admin')
  );
$$;

-- =====================================================================
-- RLS  (la cl anon est publique : toute la scurit est ici)
-- =====================================================================
alter table public.profiles    enable row level security;
alter table public.etalons     enable row level security;
alter table public.imputations enable row level security;
alter table public.journal     enable row level security;

-- profiles : lecture quipe, criture de son propre profil
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- etalons : lecture tous ; criture rserve aux rfrents
create policy etalons_select on public.etalons for select to authenticated using (true);
create policy etalons_insert on public.etalons for insert to authenticated with check (public.is_referent());
create policy etalons_update on public.etalons for update to authenticated using (public.is_referent()) with check (public.is_referent());

-- imputations : strictement perso (select/insert/update/delete)
create policy imputations_all on public.imputations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- journal : lecture quipe, criture/maj de ses propres entres
create policy journal_select on public.journal for select to authenticated using (true);
create policy journal_insert on public.journal for insert to authenticated with check (user_id = auth.uid());
create policy journal_update on public.journal for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =====================================================================
-- NOTES
-- =====================================================================
-- > Promouvoir un rfrent (peut crer/diter les talons) :
--     update public.profiles set role = 'referent' where id = '<uuid-du-user>';
--   (uuid visible dans Authentication > Users)
--
-- > Passer le journal en PERSO au lieu de partag :
--     drop policy journal_select on public.journal;
--     create policy journal_select on public.journal for select to authenticated
--       using (user_id = auth.uid());
