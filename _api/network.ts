import { serverDb, json } from '../src/lib/server/access';
import { nodeHandler } from '../src/lib/server/http-handler';
import { DEFAULT_ROUTE_ID } from '../src/lib/fleet/registry';
import { projectLatLngOntoRoute } from '../src/lib/route/route-geometry';
export async function GET() {
  const db = serverDb(); if (!db) return json({error:'Network unavailable'},503);
  const result = await db.from('fleet_stations').select('id,name,location,station_number,latitude,longitude').eq('route_id',DEFAULT_ROUTE_ID).is('archived_at',null).order('station_number');
  if (result.error) return json({error:'Network unavailable'},503);
  return new Response(JSON.stringify({stations:result.data.map(s=>({id:String(s.station_number),name:s.name,location:s.location,stationNumber:s.station_number,latitude:s.latitude,longitude:s.longitude,position:projectLatLngOntoRoute(s.latitude,s.longitude).positionPercent}))}),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=30, s-maxage=60'}});
}
export default nodeHandler({GET});
