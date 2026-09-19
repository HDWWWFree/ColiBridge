-- =====================================================================
-- COLIBRIDGE — schéma Supabase v0.1
-- Covoiturage de colis France <-> Maghreb (affaires personnelles,
-- voyageurs en voiture, fourgon, avion, bus ou bateau)
--
-- À exécuter en une fois dans un NOUVEAU projet Supabase :
--   Dashboard > SQL Editor > New query > coller > Run
--
-- Principes :
--  * Aucun paiement sur la plateforme (mise en relation uniquement).
--  * Charte acceptée à l'inscription, à chaque trajet et à chaque
--    réservation, avec horodatage posé par le SERVEUR (non falsifiable).
--  * Code de remise : connu du client seul, donné au destinataire, qui le
--    communique au voyageur à la livraison (preuve de remise).
--  * Champs sensibles (vérification, capacité restante, compteurs)
--    protégés côté base : un utilisateur ne peut pas se les attribuer.
--  * Convention : auth.uid() IS NULL = appel admin (SQL editor / service_role).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PROFILS
-- ---------------------------------------------------------------------
create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  full_name           text not null default '',
  city                text,
  country             text check (country in ('FR','DZ','MA','TN')),
  avatar_url          text,
  is_verified_driver  boolean not null default false,   -- posé par l'admin uniquement
  deliveries_count    int     not null default 0,       -- géré par la base
  is_banned           boolean not null default false,   -- posé par l'admin uniquement
  charter_accepted_at timestamptz,
  charter_version     text,
  created_at          timestamptz not null default now()
);

-- Création automatique du profil à l'inscription.
-- Côté client : supabase.auth.signUp({ email, password, options: { data: {
--   full_name: '...', charter_accepted: 'true', charter_version: 'v1' } } })
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, charter_accepted_at, charter_version)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when new.raw_user_meta_data->>'charter_accepted' = 'true' then now() end,
    new.raw_user_meta_data->>'charter_version'
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Colonnes protégées : un utilisateur ne peut pas les modifier lui-même.
create function public.protect_profile_columns() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.internal', true), '') <> 'on' then
    new.is_verified_driver := old.is_verified_driver;
    new.deliveries_count   := old.deliveries_count;
    new.is_banned          := old.is_banned;
    new.charter_accepted_at := old.charter_accepted_at;
    new.charter_version     := old.charter_version;
  end if;
  return new;
end $$;

create trigger trg_protect_profile
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

alter table public.profiles enable row level security;

-- Tout utilisateur connecté voit les profils (nom, ville, badge, compteur).
create policy profiles_select on public.profiles
  for select to authenticated using (true);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());


-- ---------------------------------------------------------------------
-- 2. PROFIL VOYAGEUR (données privées : permis, plaque, pièce d'identité)
-- ---------------------------------------------------------------------
create table public.driver_profiles (
  user_id             uuid primary key references public.profiles(id) on delete cascade,
  vehicle_model       text,
  plate               text,        -- requis pour voiture / fourgon / camionnette
  license_number      text,        -- idem (inutile pour avion, bus, bateau)
  id_document_path    text,        -- chemin dans le bucket privé 'identity-docs'
  verification_status text not null default 'pending'
                      check (verification_status in ('pending','verified','rejected')),
  created_at          timestamptz not null default now()
);

create function public.driver_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.internal', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.verification_status := 'pending';
    else
      new.verification_status := old.verification_status;
      -- changer plaque, permis ou pièce d'identité = nouvelle vérification
      if (new.plate, new.license_number, new.id_document_path)
         is distinct from (old.plate, old.license_number, old.id_document_path) then
        new.verification_status := 'pending';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger trg_driver_profiles_guard
  before insert or update on public.driver_profiles
  for each row execute function public.driver_profiles_guard();

-- Synchronise le badge "Voyageur vérifié" sur le profil public.
create function public.driver_profiles_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.internal', 'on', true);
  update public.profiles
     set is_verified_driver = (new.verification_status = 'verified')
   where id = new.user_id;
  perform set_config('app.internal', 'off', true);
  return new;
end $$;

create trigger trg_driver_profiles_sync
  after insert or update of verification_status on public.driver_profiles
  for each row execute function public.driver_profiles_sync();

alter table public.driver_profiles enable row level security;

create policy driver_profiles_select_own on public.driver_profiles
  for select to authenticated using (user_id = auth.uid());
create policy driver_profiles_insert_own on public.driver_profiles
  for insert to authenticated with check (user_id = auth.uid());
create policy driver_profiles_update_own on public.driver_profiles
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Stockage privé des pièces d'identité (un dossier par utilisateur : <uid>/fichier)
insert into storage.buckets (id, name, public)
values ('identity-docs', 'identity-docs', false)
on conflict (id) do nothing;

create policy identity_docs_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'identity-docs'
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy identity_docs_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'identity-docs'
         and (storage.foldername(name))[1] = auth.uid()::text);

-- VALIDATION D'UN VOYAGEUR (par toi, dans le SQL editor) :
--   update public.driver_profiles set verification_status = 'verified'
--   where user_id = '<uuid>';


-- ---------------------------------------------------------------------
-- 3. TRAJETS
-- ---------------------------------------------------------------------
create table public.trips (
  id                  uuid primary key default gen_random_uuid(),
  driver_id           uuid not null references public.profiles(id) on delete cascade,

  origin_city         text not null,
  origin_country      text not null check (origin_country in ('FR','DZ','MA','TN')),
  origin_point        text,                       -- ex : "Port de Marseille"
  origin_lat          double precision,
  origin_lng          double precision,

  dest_city           text not null,
  dest_country        text not null check (dest_country in ('FR','DZ','MA','TN')),
  dest_point          text,
  dest_lat            double precision,
  dest_lng            double precision,

  departure_at        timestamptz not null,
  arrival_at          timestamptz,

  transport_mode      text not null
                      check (transport_mode in ('voiture','fourgon','camionnette','avion','bus','bateau')),
  capacity_kg         numeric(7,1) not null check (capacity_kg > 0),   -- kg (bagage dispo pour l'avion)
  remaining_kg        numeric(7,1) not null,      -- géré par la base
  max_item_size       text,                       -- ex : "pas plus de 80 cm"
  price_per_kg        numeric(8,2) not null check (price_per_kg >= 0),
  currency            text not null default 'EUR' check (currency in ('EUR','DZD','MAD','TND')),
  notes               text,

  status              text not null default 'open'
                      check (status in ('open','full','departed','completed','cancelled')),

  charter_accepted    boolean not null check (charter_accepted),
  charter_accepted_at timestamptz not null default now(),
  charter_version     text not null,
  created_at          timestamptz not null default now(),

  -- trajet France <-> Maghreb uniquement
  check (origin_country <> dest_country),
  check (origin_country = 'FR' or dest_country = 'FR'),
  check (remaining_kg >= 0 and remaining_kg <= capacity_kg)
);

create index trips_search_idx on public.trips (origin_country, dest_country, departure_at)
  where status = 'open';
create index trips_driver_idx on public.trips (driver_id);

create function public.trips_before_insert() returns trigger
language plpgsql as $$
begin
  new.remaining_kg        := new.capacity_kg;
  new.status              := 'open';
  new.charter_accepted_at := now();
  return new;
end $$;

create trigger trg_trips_before_insert
  before insert on public.trips
  for each row execute function public.trips_before_insert();

create function public.trips_before_update() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.internal', true), '') <> 'on' then
    new.driver_id           := old.driver_id;
    new.capacity_kg         := old.capacity_kg;   -- pas modifiable : annuler et republier
    new.remaining_kg        := old.remaining_kg;
    new.charter_accepted_at := old.charter_accepted_at;
  end if;
  return new;
end $$;

create trigger trg_trips_before_update
  before update on public.trips
  for each row execute function public.trips_before_update();

alter table public.trips enable row level security;

create policy trips_select on public.trips
  for select to authenticated
  using (status <> 'cancelled' or driver_id = auth.uid());

-- Publier : avoir rempli son profil voyageur (plaque + permis pour un trajet
-- routier, pièce d'identité pour tous), ne pas être banni.
create policy trips_insert on public.trips
  for insert to authenticated
  with check (
    driver_id = auth.uid()
    and exists (select 1 from public.driver_profiles d
                where d.user_id = auth.uid()
                  and (transport_mode in ('avion','bus','bateau')
                       or (d.plate is not null and d.license_number is not null)))
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_banned)
  );

create policy trips_update_own on public.trips
  for update to authenticated
  using (driver_id = auth.uid()) with check (driver_id = auth.uid());

-- Ajuste la capacité restante (appelée uniquement par les triggers ci-dessous).
create function public.adjust_trip_capacity(p_trip uuid, p_delta numeric) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  perform set_config('app.internal', 'on', true);
  update public.trips
     set remaining_kg = remaining_kg + p_delta,
         status = case
                    when remaining_kg + p_delta <= 0 and status = 'open' then 'full'
                    when remaining_kg + p_delta > 0 and status = 'full'  then 'open'
                    else status
                  end
   where id = p_trip
     and remaining_kg + p_delta >= 0
     and remaining_kg + p_delta <= capacity_kg;
  ok := found;
  perform set_config('app.internal', 'off', true);
  return ok;
end $$;

revoke execute on function public.adjust_trip_capacity(uuid, numeric) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. RÉSERVATIONS
--    pending -> accepted -> picked_up -> delivered
--    (ou refused / cancelled)
-- ---------------------------------------------------------------------
create table public.reservations (
  id                  uuid primary key default gen_random_uuid(),
  trip_id             uuid not null references public.trips(id) on delete cascade,
  client_id           uuid not null references public.profiles(id) on delete cascade,

  weight_kg           numeric(6,1) not null check (weight_kg > 0),
  content_category    text not null check (content_category in
                        ('vetements','documents','electronique','cadeaux','alimentaire','autre')),
  content_description text not null check (char_length(content_description) between 5 and 500),
  recipient_name      text not null,
  recipient_phone     text not null,

  status              text not null default 'pending'
                      check (status in ('pending','accepted','picked_up','delivered','refused','cancelled')),

  -- Charte : case cochée + case "le voyageur peut vérifier le contenu"
  charter_accepted    boolean not null check (charter_accepted),
  inspection_accepted boolean not null check (inspection_accepted),
  charter_accepted_at timestamptz not null default now(),
  charter_version     text not null,

  delivered_at        timestamptz,
  created_at          timestamptz not null default now()
);

create index reservations_trip_idx   on public.reservations (trip_id);
create index reservations_client_idx on public.reservations (client_id);

-- Code de remise : visible du client uniquement (table séparée).
create table public.reservation_secrets (
  reservation_id uuid primary key references public.reservations(id) on delete cascade,
  delivery_code  text not null,
  attempts       int  not null default 0
);

alter table public.reservation_secrets enable row level security;

create policy secrets_select_client on public.reservation_secrets
  for select to authenticated
  using (exists (select 1 from public.reservations r
                 where r.id = reservation_id and r.client_id = auth.uid()));

create function public.reservations_before_insert() returns trigger
language plpgsql as $$
begin
  new.status              := 'pending';
  new.charter_accepted_at := now();
  new.delivered_at        := null;
  return new;
end $$;

create trigger trg_reservations_before_insert
  before insert on public.reservations
  for each row execute function public.reservations_before_insert();

-- Génère le code de remise à 6 chiffres.
create function public.reservations_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.reservation_secrets (reservation_id, delivery_code)
  values (
    new.id,
    lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint)
          % 1000000)::text, 6, '0')
  );
  return new;
end $$;

create trigger trg_reservations_after_insert
  after insert on public.reservations
  for each row execute function public.reservations_after_insert();

-- Contrôle des transitions et de la capacité.
create function public.reservations_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_driver uuid;
begin
  -- admin ou fonction interne (confirm_delivery) : pas de contrôle
  if v_uid is null or coalesce(current_setting('app.internal', true), '') = 'on' then
    return new;
  end if;

  -- champs figés
  if (new.trip_id, new.client_id, new.weight_kg, new.content_category, new.content_description,
      new.recipient_name, new.recipient_phone, new.charter_version, new.charter_accepted_at,
      new.delivered_at)
     is distinct from
     (old.trip_id, old.client_id, old.weight_kg, old.content_category, old.content_description,
      old.recipient_name, old.recipient_phone, old.charter_version, old.charter_accepted_at,
      old.delivered_at) then
    raise exception 'Champs non modifiables';
  end if;

  if new.status = old.status then
    return new;
  end if;

  select driver_id into v_driver from public.trips where id = old.trip_id;

  if v_uid = v_driver then
    if old.status = 'pending' and new.status = 'accepted' then
      if not public.adjust_trip_capacity(old.trip_id, -old.weight_kg) then
        raise exception 'Capacité insuffisante sur ce trajet';
      end if;
    elsif old.status = 'pending'  and new.status = 'refused'   then null;
    elsif old.status = 'accepted' and new.status = 'picked_up' then null;
    elsif old.status = 'accepted' and new.status = 'cancelled' then
      perform public.adjust_trip_capacity(old.trip_id, old.weight_kg);
    else
      raise exception 'Transition interdite pour le voyageur (% -> %)', old.status, new.status;
    end if;

  elsif v_uid = old.client_id then
    if old.status = 'pending' and new.status = 'cancelled' then null;
    elsif old.status = 'accepted' and new.status = 'cancelled' then
      perform public.adjust_trip_capacity(old.trip_id, old.weight_kg);
    else
      raise exception 'Transition interdite pour le client (% -> %)', old.status, new.status;
    end if;

  else
    raise exception 'Non autorisé';
  end if;

  return new;
end $$;

create trigger trg_reservations_before_update
  before update on public.reservations
  for each row execute function public.reservations_before_update();

alter table public.reservations enable row level security;

create policy reservations_select on public.reservations
  for select to authenticated
  using (client_id = auth.uid()
         or exists (select 1 from public.trips t where t.id = trip_id and t.driver_id = auth.uid()));

create policy reservations_insert on public.reservations
  for insert to authenticated
  with check (
    client_id = auth.uid()
    and exists (select 1 from public.trips t
                where t.id = trip_id and t.status = 'open'
                  and t.driver_id <> auth.uid()
                  and t.remaining_kg >= weight_kg)
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_banned)
  );

create policy reservations_update on public.reservations
  for update to authenticated
  using (client_id = auth.uid()
         or exists (select 1 from public.trips t where t.id = trip_id and t.driver_id = auth.uid()));

-- Confirmation de livraison par le voyageur avec le code donné par le destinataire.
-- Retourne true si OK, false si code incorrect (5 essais max).
--   supabase.rpc('confirm_delivery', { p_reservation: id, p_code: '123456' })
create function public.confirm_delivery(p_reservation uuid, p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  r        public.reservations;
  v_driver uuid;
  v_secret public.reservation_secrets;
begin
  select * into r from public.reservations where id = p_reservation for update;
  if not found then raise exception 'Réservation introuvable'; end if;

  select driver_id into v_driver from public.trips where id = r.trip_id;
  if v_driver is distinct from auth.uid() then raise exception 'Non autorisé'; end if;

  if r.status <> 'picked_up' then
    raise exception 'Le colis doit d''abord être marqué comme récupéré';
  end if;

  select * into v_secret from public.reservation_secrets
   where reservation_id = p_reservation for update;

  if v_secret.attempts >= 5 then
    raise exception 'Trop de tentatives, contactez le support';
  end if;

  if v_secret.delivery_code <> trim(p_code) then
    update public.reservation_secrets
       set attempts = attempts + 1 where reservation_id = p_reservation;
    return false;   -- pas d'exception : le compteur doit être conservé
  end if;

  perform set_config('app.internal', 'on', true);
  update public.reservations set status = 'delivered', delivered_at = now()
   where id = p_reservation;
  update public.profiles set deliveries_count = deliveries_count + 1 where id = v_driver;
  perform set_config('app.internal', 'off', true);
  return true;
end $$;

revoke execute on function public.confirm_delivery(uuid, text) from public, anon;
grant  execute on function public.confirm_delivery(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 5. MESSAGES (chat par réservation)
-- ---------------------------------------------------------------------
create function public.is_reservation_participant(p_res uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.reservations r
    join public.trips t on t.id = r.trip_id
    where r.id = p_res and (r.client_id = auth.uid() or t.driver_id = auth.uid())
  );
$$;

create table public.messages (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  sender_id      uuid not null references public.profiles(id) on delete cascade,
  body           text not null check (char_length(body) between 1 and 2000),
  created_at     timestamptz not null default now()
);

create index messages_reservation_idx on public.messages (reservation_id, created_at);

alter table public.messages enable row level security;

create policy messages_select on public.messages
  for select to authenticated using (public.is_reservation_participant(reservation_id));

create policy messages_insert on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_reservation_participant(reservation_id));


-- ---------------------------------------------------------------------
-- 6. NOTATION (dans les deux sens, uniquement après livraison)
-- ---------------------------------------------------------------------
create table public.ratings (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  rater_id       uuid not null references public.profiles(id) on delete cascade,
  ratee_id       uuid not null references public.profiles(id) on delete cascade,
  rater_role     text not null check (rater_role in ('client','driver')),
  stars          smallint not null check (stars between 1 and 5),
  comment        text check (char_length(comment) <= 500),
  created_at     timestamptz not null default now(),
  unique (reservation_id, rater_id)
);

create index ratings_ratee_idx on public.ratings (ratee_id);

alter table public.ratings enable row level security;

create policy ratings_select on public.ratings
  for select to authenticated using (true);

create policy ratings_insert on public.ratings
  for insert to authenticated
  with check (
    rater_id = auth.uid()
    and exists (
      select 1 from public.reservations r
      join public.trips t on t.id = r.trip_id
      where r.id = reservation_id
        and r.status = 'delivered'
        and (
          (rater_role = 'client' and r.client_id = auth.uid() and t.driver_id = ratee_id)
          or
          (rater_role = 'driver' and t.driver_id = auth.uid() and r.client_id = ratee_id)
        )
    )
  );

-- Moyennes : "en tant que voyageur" (notes données par les clients)
-- et "en tant que client" (notes données par les voyageurs).
create view public.user_ratings with (security_invoker = true) as
select
  ratee_id as user_id,
  round(avg(stars) filter (where rater_role = 'client'), 2) as avg_as_driver,
  count(*)         filter (where rater_role = 'client')     as count_as_driver,
  round(avg(stars) filter (where rater_role = 'driver'), 2) as avg_as_client,
  count(*)         filter (where rater_role = 'driver')     as count_as_client
from public.ratings
group by ratee_id;


-- ---------------------------------------------------------------------
-- 7. SIGNALEMENTS
-- ---------------------------------------------------------------------
create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete set null,
  reservation_id   uuid references public.reservations(id) on delete set null,
  reason           text not null check (reason in
                     ('contenu_illicite','colis_suspect','comportement','fraude','autre')),
  details          text check (char_length(details) <= 1000),
  status           text not null default 'open' check (status in ('open','reviewing','closed')),
  created_at       timestamptz not null default now()
);

alter table public.reports enable row level security;

create policy reports_insert on public.reports
  for insert to authenticated with check (reporter_id = auth.uid());
create policy reports_select_own on public.reports
  for select to authenticated using (reporter_id = auth.uid());

-- Modération : consulte et traite les signalements depuis le SQL editor,
-- ex : update public.profiles set is_banned = true where id = '<uuid>';


-- ---------------------------------------------------------------------
-- 8. TEMPS RÉEL (respecte les règles RLS ci-dessus)
-- ---------------------------------------------------------------------
alter publication supabase_realtime
  add table public.messages, public.reservations, public.trips;
