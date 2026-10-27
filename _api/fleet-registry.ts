import { requireAdmin, serverDb, json } from '../src/lib/server/access';
import { nodeHandler } from '../src/lib/server/http-handler';
import { registry, validEntity, validateRecord, isUuid, DEFAULT_ROUTE_ID } from '../src/lib/fleet/registry';

export async function GET(request: Request) {
  const denied = await requireAdmin(request); if (denied) return denied;
  const url = new URL(request.url); const entity = url.searchParams.get('entity');
  if (!validEntity(entity)) return json({ error: 'Unknown record type' }, 400);
  const page = Math.max(0, Math.min(10000, Math.floor(Number(url.searchParams.get('page')) || 0)));
  const queryText = (url.searchParams.get('search') ?? '').trim().slice(0,80).replace(/[%_\\]/g, '');
  let query = serverDb()!.from(registry[entity].table).select('*', { count: 'exact' }).order('updated_at', { ascending: false }).order('id');
  query = url.searchParams.get('archived') === 'true' ? query.not('archived_at','is',null) : query.is('archived_at', null);
  if (queryText) query = query.ilike(entity === 'vehicles' ? 'plate_number' : 'name', `%${queryText}%`);
  const { data, count, error } = await query.range(page * 25, page * 25 + 24);
  if (error) return json({ error: 'Unable to load records. Check database setup.' }, 503);
  return json({ records: data, total: count });
}
export async function POST(request: Request) { return save(request, false); }
export async function PATCH(request: Request) { return save(request, true); }
async function save(request: Request, update: boolean) {
  const denied = await requireAdmin(request); if (denied) return denied;
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' },400); }
  if (!body || !validEntity(body.entity) || (update && !isUuid(body.id))) return json({ error: 'Invalid record request' },400);
  let values: Record<string, unknown>;
  try {
    if (update && typeof body.archived === 'boolean') {
      if (body.archived && body.entity === 'routes' && body.id === DEFAULT_ROUTE_ID) throw new Error('The current public route cannot be archived.');
      values = { archived_at: body.archived ? new Date().toISOString() : null };
    } else values = validateRecord(body.entity, body.record);
  } catch (error) { return json({ error: (error as Error).message },400); }
  const db = serverDb()!;
  for (const field of registry[body.entity as keyof typeof registry].fields) {
    if (!field.reference || !values[field.key]) continue;
    const ref = await db.from(registry[field.reference].table).select('id').eq('id',values[field.key]).is('archived_at',null).maybeSingle();
    if (ref.error || !ref.data) return json({error:`Select an active ${field.label.toLowerCase()}`},400);
  }
  values.updated_at = new Date().toISOString();
  const table = db.from(registry[body.entity as keyof typeof registry].table);
  const { data, error } = await (update ? table.update(values).eq('id',body.id) : table.insert(values)).select().maybeSingle();
  if (error) return json({error: error.code === '23505' ? 'That plate, device ID, route code or station number already exists.' : 'Unable to save this record.'},error.code === '23505' ? 409 : 400);
  if (!data) return json({error:'Record no longer exists'},404);
  return json({record:data}, update ? 200 : 201);
}
export default nodeHandler({ GET, POST, PATCH });
