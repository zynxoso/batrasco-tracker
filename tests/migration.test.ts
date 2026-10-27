import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { it,expect } from 'vitest';
it('migration is repeatable; records persist; public and non-admin roles cannot change fleet data',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;`);
    const sql=readFileSync('supabase/migrations/202610270001_fleet_management.sql','utf8');
    await db.exec(sql);await db.exec(sql);
    const routes=await db.query('select * from fleet_routes');expect(routes.rows).toHaveLength(1);
    expect((await db.query('select * from fleet_stations')).rows).toHaveLength(3);
    const admin='11111111-1111-4111-8111-111111111111';
    await db.query('insert into auth.users(id) values($1)',[admin]);
    await db.query('insert into fleet_admins(user_id) values($1)',[admin]);
    await db.exec('set role anon');
    await expect(db.query('select * from tracker_latest')).rejects.toThrow();
    expect((await db.query<{allowed:boolean}>('select public.is_fleet_admin() as allowed')).rows[0].allowed).toBe(false);
    await db.exec('set role authenticated');
    await expect(db.query("insert into fleet_drivers(name) values('Unauthorized')")).rejects.toThrow();
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
    await db.query("insert into fleet_drivers(name) values('Test driver')");
    expect((await db.query("select name from fleet_drivers where name='Test driver'")).rows).toHaveLength(1);
    await expect(db.query("insert into fleet_vehicles(plate_number,capacity) values('BAD',0)")).rejects.toThrow();
    await expect(db.query('insert into fleet_admins(user_id) values(gen_random_uuid())')).rejects.toThrow();
    await db.exec('reset role');
    await db.query("update fleet_drivers set archived_at=now() where name='Test driver'");
    expect((await db.query('select * from fleet_drivers where archived_at is null')).rows).toHaveLength(0);
  }finally{await db.close();}
},30000);
