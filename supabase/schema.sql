-- Suivi des élèves : schéma de la base Supabase (tables, règles d'accès, déclencheurs).
-- Usage : tableau de bord Supabase > SQL Editor > New query, coller ce fichier en entier, puis « Run ».
-- Ré-exécutable sans erreur ni perte de données : à relancer tel quel après chaque mise à jour du fichier.
-- Règles d'accès (RLS) : voir TRAME-PROJET.md, § 4. Les comptes ne se créent que par la fonction gestion-eleves.

-- ============================================================ tables

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  prof_id uuid not null default auth.uid(),
  nom text not null check (length(btrim(nom)) between 1 and 40),
  annee text not null check (annee ~ '^[0-9]{4}-[0-9]{4}$'),
  cree_le timestamptz not null default now(),
  unique (prof_id, nom, annee)
);

create table if not exists public.profils (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('prof', 'eleve')),
  prenom text not null check (length(btrim(prenom)) between 1 and 60),
  nom text not null check (length(btrim(nom)) between 1 and 60),
  identifiant text not null unique check (identifiant ~ '^[a-z0-9.@_+-]{3,80}$'),
  -- un élève appartient à une classe ; un prof à aucune (« restrict » : on retire les élèves avant la classe)
  classe_id uuid references public.classes (id) on delete restrict,
  cree_le timestamptz not null default now(),
  constraint profils_classe_selon_role check ((role = 'eleve') = (classe_id is not null))
);

-- classes → profils, ajoutée à part : les deux tables se citent l'une l'autre
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'classes_prof_fk') then
    alter table public.classes
      add constraint classes_prof_fk foreign key (prof_id) references public.profils (id) on delete restrict;
  end if;
end $$;

create table if not exists public.tentatives (
  id uuid primary key,                       -- généré par le navigateur : un envoi répété ne crée pas de doublon
  eleve_id uuid not null default auth.uid() references public.profils (id) on delete cascade,
  classe_id uuid not null references public.classes (id) on delete cascade,
  depot text not null check (depot ~ '^[a-z0-9-]{1,60}$'),
  activite text not null check (activite ~ '^[a-z0-9-]{1,60}$'),
  mode text not null check (mode in ('entrainement', 'examen')),
  statut text not null default 'en_cours' check (statut in ('en_cours', 'remise')),
  debut timestamptz not null,
  fin timestamptz,
  duree_s integer check (duree_s >= 0),
  note20 numeric(4, 2) check (note20 between 0 and 20),
  note20_provisoire numeric(4, 2) check (note20_provisoire between 0 and 20),
  points numeric(7, 2) check (points >= 0),
  points_max numeric(7, 2) check (points_max >= 0),
  items_valides integer check (items_valides >= 0),
  items_total integer check (items_total >= 0),
  detail jsonb not null default '{}'::jsonb check (octet_length(detail::text) <= 262144),
  version_module text check (length(version_module) <= 40),
  maj_le timestamptz not null default now()
);

create index if not exists profils_classe_idx on public.profils (classe_id);
create index if not exists tentatives_classe_idx on public.tentatives (classe_id, depot, activite);
create index if not exists tentatives_eleve_idx on public.tentatives (eleve_id, depot, activite);

-- ============================================================ fonctions utiles aux règles d'accès
-- « security definer » : elles lisent les tables sans repasser par leurs règles, ce qui évite des règles récursives.

create or replace function public.est_prof() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profils p where p.id = (select auth.uid()) and p.role = 'prof')
$$;

create or replace function public.ma_classe() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.classe_id from public.profils p where p.id = (select auth.uid())
$$;

create or replace function public.classes_du_prof() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.classes c where c.prof_id = (select auth.uid())
$$;

-- appelée par la page de diagnostic et par le maintien (.github/workflows/maintien.yml), sans compte
create or replace function public.ping() returns text
language sql stable set search_path = '' as $$
  select 'ok'::text
$$;

revoke execute on function public.est_prof(), public.ma_classe(), public.classes_du_prof() from public, anon;
grant execute on function public.est_prof(), public.ma_classe(), public.classes_du_prof() to authenticated;
grant execute on function public.ping() to anon, authenticated;

-- ============================================================ déclencheur des tentatives
-- Une tentative remise ne change plus ; ses champs d'identité ne changent jamais.
-- Codes PTxxx : l'API (PostgREST) répond avec le statut HTTP xxx (409 : déjà remise, 400 : champ non modifiable).

create or replace function public.tentatives_controle() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if old.statut = 'remise' then
      raise exception 'Tentative déjà remise : modification refusée.' using errcode = 'PT409';
    end if;
    if new.eleve_id is distinct from old.eleve_id or new.classe_id is distinct from old.classe_id
       or new.depot is distinct from old.depot or new.activite is distinct from old.activite
       or new.mode is distinct from old.mode or new.debut is distinct from old.debut then
      raise exception 'Tentative : élève, classe, dépôt, activité, mode et début ne se modifient pas.'
        using errcode = 'PT400';
    end if;
  end if;
  new.maj_le := now();
  return new;
end
$$;

drop trigger if exists tentatives_controle on public.tentatives;
create trigger tentatives_controle before insert or update on public.tentatives
  for each row execute function public.tentatives_controle();

-- ============================================================ droits et règles d'accès (RLS)
-- Aucun droit sans compte (anon). Les écritures sur profils, et les suppressions, passent par la fonction
-- gestion-eleves (clé de service, qui ignore ces règles).

alter table public.profils enable row level security;
alter table public.classes enable row level security;
alter table public.tentatives enable row level security;

revoke all on public.profils, public.classes, public.tentatives from anon, authenticated;
grant select on public.profils to authenticated;
grant select, insert on public.classes to authenticated;
grant update (nom, annee) on public.classes to authenticated;
grant select, insert, update on public.tentatives to authenticated;

-- profils : chacun lit sa ligne ; un prof lit aussi les élèves de ses classes
drop policy if exists profils_lecture on public.profils;
create policy profils_lecture on public.profils for select to authenticated
  using (id = (select auth.uid()) or classe_id in (select public.classes_du_prof()));

-- classes : un prof lit, crée et renomme les siennes ; un élève lit la sienne
drop policy if exists classes_lecture on public.classes;
create policy classes_lecture on public.classes for select to authenticated
  using (prof_id = (select auth.uid()) or id = (select public.ma_classe()));

drop policy if exists classes_creation on public.classes;
create policy classes_creation on public.classes for insert to authenticated
  with check (prof_id = (select auth.uid()) and (select public.est_prof()));

drop policy if exists classes_modification on public.classes;
create policy classes_modification on public.classes for update to authenticated
  using (prof_id = (select auth.uid())) with check (prof_id = (select auth.uid()));

-- tentatives : un élève crée, modifie (tant qu'elles sont en cours, voir le déclencheur) et lit les siennes ;
-- un prof lit celles de ses classes et n'écrit rien
drop policy if exists tentatives_lecture on public.tentatives;
create policy tentatives_lecture on public.tentatives for select to authenticated
  using (eleve_id = (select auth.uid()) or classe_id in (select public.classes_du_prof()));

drop policy if exists tentatives_creation on public.tentatives;
create policy tentatives_creation on public.tentatives for insert to authenticated
  with check (eleve_id = (select auth.uid()) and classe_id = (select public.ma_classe()));

drop policy if exists tentatives_modification on public.tentatives;
create policy tentatives_modification on public.tentatives for update to authenticated
  using (eleve_id = (select auth.uid()))
  with check (eleve_id = (select auth.uid()) and classe_id = (select public.ma_classe()));

-- ============================================================ déclarer un compte prof (à faire une fois, à la main)
-- 1. Authentication > Users > Add user > Create new user : ton adresse, un mot de passe de 12 caractères au moins,
--    « Auto Confirm User » coché.
-- 2. Dans une nouvelle requête, remplace l'adresse, le prénom et le nom, puis « Run » :
--
-- insert into public.profils (id, role, prenom, nom, identifiant)
-- select id, 'prof', 'Prénom', 'Nom', lower(email) from auth.users where email = 'ton.adresse@exemple.fr';
