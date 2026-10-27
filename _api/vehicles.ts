import { getLatestVehiclesFromDbWithMeta } from '../src/lib/server/tracker-db';
import { requireAdmin, serverDb, json } from '../src/lib/server/access';
import { nodeHandler } from '../src/lib/server/http-handler';
import { DEFAULT_ROUTE_ID } from '../src/lib/fleet/registry';
import { createHash } from 'node:crypto';
export async function GET(request: Request) {
  const admin = new URL(request.url).searchParams.get('admin') === 'true';
  if(admin){const denied=await requireAdmin(request);if(denied)return denied;}
  const db=serverDb();if(!db)return json({error:'Vehicle service unavailable'},503);
  const registry=await db.from('fleet_vehicles').select('id,plate_number,device_id,capacity,availability,route_id,fleet_drivers(name)').is('archived_at',null);
  if(registry.error)return json({error:'Fleet setup is incomplete'},503);
  const feed=await getLatestVehiclesFromDbWithMeta();
  if(feed.error)return json({error:'Location updates unavailable'},503);
  const byDevice=new Map(feed.vehicles.map(v=>[v.id,v]));
  const vehicles=registry.data.filter(row=>admin||(row.availability==='active'&&row.route_id===DEFAULT_ROUTE_ID)).map(row=>{
    const v=row.device_id?byDevice.get(row.device_id):null;
    const driver=(row.fleet_drivers as unknown as {name?:string}|null)?.name;
    return {
      id:admin?(row.device_id||row.id):row.id,plateNumber:row.plate_number,driver:admin?(driver||'Unassigned'):'',
      capacity:row.capacity,passengers:null,currentPosition:v?.currentPosition??0,
      speed:v?.trackerOnline?v.speed:0,status:v?.status??'offline',trackerOnline:v?.trackerOnline??false,
      lastUpdated:v?.lastUpdated??'',latitude:v?.latitude,longitude:v?.longitude,
      etaInDirectionOfTravel:v?.trackerOnline?v.etaInDirectionOfTravel:'Unavailable',
      headingTowardLipa:v?.headingTowardLipa,direction:v?.direction,
      ingestEnabled:v?.ingestEnabled??true,...(admin?{scrapeIntervalMs:v?.scrapeIntervalMs}:{}),
    };
  });
  const body=JSON.stringify(vehicles);const etag=`"${createHash('sha256').update(body).digest('hex')}"`;
  const headers={'Content-Type':'application/json','Cache-Control':admin?'private, no-store':'public, max-age=0, s-maxage=10',ETag:etag,'X-Vehicles-Source':'database'};
  return request.headers.get('if-none-match')===etag?new Response(null,{status:304,headers}):new Response(body,{headers});
}
export default nodeHandler({GET});
