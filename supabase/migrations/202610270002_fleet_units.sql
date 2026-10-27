-- Run after 202610270001_fleet_management.sql in the Supabase SQL Editor.
-- The current app stores its unit label in plate_number (these are not license plates).
-- Capacity 20 is the existing default; review it before using real fleet operations.
-- No GPS IDs or location reports are invented. Existing records are preserved.
begin;

insert into public.fleet_vehicles (plate_number, route_id, capacity, availability)
select unit_number, (select id from public.fleet_routes where code = 'BAT-LIP-001'), 20, 'active'
from (values ('68'),('10'),('09'),('07'),('71'),('05'),('69'),('87'),('02'),('06')) as units(unit_number)
on conflict (plate_number) do nothing;

commit;

-- Verify the ten records. GPS device IDs stay null until real trackers are assigned.
select plate_number as unit_number, device_id, capacity, availability
from public.fleet_vehicles
where plate_number in ('68','10','09','07','71','05','69','87','02','06')
order by array_position(array['68','10','09','07','71','05','69','87','02','06'], plate_number);
