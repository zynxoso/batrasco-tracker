import { createClient } from '@supabase/supabase-js';
try { process.loadEnvFile('.env.local'); } catch {}
const url=process.env.SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key){console.log('Server database credentials: missing');process.exit(1);}
const db=createClient(url,key,{auth:{persistSession:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(10000)})}});
for(const table of ['fleet_admins','fleet_routes','fleet_drivers','fleet_vehicles','fleet_stations','fleet_settings','tracker_latest']){
  const {error,data}=await db.from(table).select('*').limit(1);
  console.log(`${table}: ${error ? `unavailable (${error.code || 'connection'})` : Array.isArray(data) ? `ready (sample ${data.length})` : 'unverified response'}`);
}
