import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const db=vi.hoisted(()=>({auth:{getUser:vi.fn()},from:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>db}));
import {requireAdmin,requireIngest,secretMatches} from '../src/lib/server/access';
import {PATCH as toggle} from '../_api/vehicle-ingest-toggle';
import {GET as history} from '../_api/tracker-history';
import {POST as ingest} from '../_api/ingest';
beforeEach(()=>{vi.stubEnv('SUPABASE_URL','https://example.test');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-only');vi.resetAllMocks();});
afterEach(()=>vi.unstubAllEnvs());
it('protects settings, history and registry access before data work',async()=>{
  expect((await toggle(new Request('http://local/api/vehicle-ingest-toggle',{method:'PATCH'}))).status).toBe(401);
  expect((await history(new Request('http://local/api/tracker-history?device_id=x'))).status).toBe(401);
  expect(db.from).not.toHaveBeenCalled();
});
it('checks the token with Supabase, never trusts a browser flag',async()=>{
  db.auth.getUser.mockResolvedValue({data:{user:null},error:{message:'invalid'}});
  expect((await requireAdmin(new Request('http://local',{headers:{Authorization:'Bearer invented'}})))?.status).toBe(401);
});
it('rejects a signed-in non-admin',async()=>{
  db.auth.getUser.mockResolvedValue({data:{user:{id:'user-1'}},error:null});
  db.from.mockReturnValue({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})});
  expect((await requireAdmin(new Request('http://local',{headers:{Authorization:'Bearer valid-test-token'}})))?.status).toBe(403);
});
it('allows a verified administrator',async()=>{
  db.auth.getUser.mockResolvedValue({data:{user:{id:'user-1'}},error:null});
  db.from.mockReturnValue({select:()=>({eq:()=>({maybeSingle:async()=>({data:{user_id:'user-1'},error:null})})})});
  expect(await requireAdmin(new Request('http://local',{headers:{Authorization:'Bearer valid-test-token'}}))).toBeNull();
});
it('does not accept GPS writes if the gateway secret is absent or wrong',async()=>{
  vi.stubEnv('TRACKER_INGEST_SECRET','');expect((await ingest(new Request('http://local',{method:'POST'}))).status).toBe(503);
  vi.stubEnv('TRACKER_INGEST_SECRET','test-secret');expect(requireIngest(new Request('http://local'))?.status).toBe(401);
  expect(secretMatches('test-secret','test-secret')).toBe(true);expect(secretMatches('wrong','test-secret')).toBe(false);
});
