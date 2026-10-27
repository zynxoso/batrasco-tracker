begin;

create table if not exists public.fleet_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.fleet_admins enable row level security;
revoke all on public.fleet_admins from anon, authenticated;
grant all on public.fleet_admins to service_role;
create or replace function public.is_fleet_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.fleet_admins where user_id = auth.uid());
$$;
revoke all on function public.is_fleet_admin() from public;
grant execute on function public.is_fleet_admin() to anon, authenticated, service_role;

create table if not exists public.fleet_routes (
  id uuid primary key default gen_random_uuid(), code text not null unique,
  name text not null, origin text not null, destination text not null,
  archived_at timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.fleet_drivers (
  id uuid primary key default gen_random_uuid(), name text not null,
  phone text, archived_at timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.fleet_vehicles (
  id uuid primary key default gen_random_uuid(), plate_number text not null unique,
  device_id text unique, driver_id uuid references public.fleet_drivers(id),
  route_id uuid references public.fleet_routes(id),
  capacity integer not null default 20 check(capacity between 1 and 100),
  availability text not null default 'active' check(availability in ('active','inactive','maintenance')),
  archived_at timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.fleet_stations (
  id uuid primary key default gen_random_uuid(), name text not null, location text not null,
  route_id uuid not null references public.fleet_routes(id),
  station_number integer not null check(station_number between 1 and 100),
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  archived_at timestamptz, updated_at timestamptz not null default now(),
  unique(route_id, station_number)
);
create table if not exists public.fleet_settings (
  id boolean primary key default true check(id), tracking_enabled boolean not null default false,
  history_days integer not null default 7 check(history_days between 1 and 30),
  updated_at timestamptz not null default now()
);
insert into public.fleet_settings(id) values(true) on conflict do nothing;

do $$ declare tbl text; begin
  foreach tbl in array array['fleet_routes','fleet_drivers','fleet_vehicles','fleet_stations','fleet_settings'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on public.%I from anon, authenticated', tbl);
    execute format('grant select, insert, update on public.%I to authenticated', tbl);
    execute format('grant all on public.%I to service_role', tbl);
    execute format('drop policy if exists fleet_admin_access on public.%I', tbl);
    execute format('create policy fleet_admin_access on public.%I for all to authenticated using (public.is_fleet_admin()) with check (public.is_fleet_admin())', tbl);
  end loop;
end $$;

insert into public.fleet_routes(id, code, name, origin, destination)
values ('00000000-0000-4000-8000-000000000001','BAT-LIP-001','Batangas–San Jose–Lipa','Batangas City','Lipa City') on conflict do nothing;
insert into public.fleet_stations(id,name,location,route_id,station_number,latitude,longitude) values
('00000000-0000-4000-8000-000000000011','Mataas na Kahoy Junction','Lipa City','00000000-0000-4000-8000-000000000001',1,13.9394312,121.122812),
('00000000-0000-4000-8000-000000000012','San Jose Church','San Jose','00000000-0000-4000-8000-000000000001',2,13.8785677,121.1042709),
('00000000-0000-4000-8000-000000000013','Batangas City, Puregold','Batangas City','00000000-0000-4000-8000-000000000001',3,13.7641749,121.0562022) on conflict do nothing;

-- Add missing telemetry structures without replacing existing records.
create table if not exists public.tracker_latest (
  device_id text primary key, vehicle_name text, latitude double precision, longitude double precision,
  speed_kmh double precision default 0, position_percent double precision default 0,
  reported_at timestamptz, updated_at timestamptz default now(), status text default 'offline',
  direction double precision, battery_percent double precision, heading_toward_lipa boolean,
  ingest_enabled boolean default true, scrape_interval_ms integer default 15000
);
alter table public.tracker_latest add column if not exists ingest_enabled boolean default true;
alter table public.tracker_latest add column if not exists scrape_interval_ms integer default 15000;
alter table public.tracker_latest add column if not exists updated_at timestamptz default now();
create table if not exists public.tracker_reports (
  id bigint generated by default as identity primary key, vehicle_id text not null,
  latitude double precision, longitude double precision, speed_kmh double precision default 0,
  position_percent double precision default 0, reported_at timestamptz not null,
  status text, direction double precision, battery_percent double precision, heading_toward_lipa boolean
);
create index if not exists tracker_reports_vehicle_time on public.tracker_reports(vehicle_id,reported_at desc);

-- Public reads must pass through the sanitized API; block direct table access.
alter table public.tracker_latest enable row level security;
alter table public.tracker_reports enable row level security;
revoke all on public.tracker_latest, public.tracker_reports from anon, authenticated;
grant all on public.tracker_latest, public.tracker_reports to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Conservative backfill: unverified vehicles start inactive until reviewed by an admin.
insert into public.fleet_vehicles(plate_number,device_id,route_id,availability)
select 'UNIT-' || device_id, device_id, '00000000-0000-4000-8000-000000000001', 'inactive'
from public.tracker_latest where device_id is not null on conflict do nothing;

-- Called by a scheduled maintenance task, never by public viewers.
create or replace function public.prune_tracker_history() returns bigint
language plpgsql security definer set search_path = '' as $$
declare removed bigint; days integer; begin
  select history_days into days from public.fleet_settings where id = true;
  delete from public.tracker_reports where reported_at < now() - make_interval(days => coalesce(days,7));
  get diagnostics removed = row_count;
  return removed;
end $$;
revoke all on function public.prune_tracker_history() from public, anon, authenticated;
grant execute on function public.prune_tracker_history() to service_role;
commit;
