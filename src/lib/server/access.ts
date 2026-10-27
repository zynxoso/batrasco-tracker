import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
export function serverDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
export async function requireAdmin(request: Request): Promise<Response | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json({ error: 'Sign-in required' }, 401);
  const db = serverDb();
  if (!db) return json({ error: 'Administration is not configured' }, 503);
  try {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return json({ error: 'Session expired or invalid' }, 401);
    const role = await db.from('fleet_admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
    if (role.error) return json({ error: 'Administration setup is incomplete' }, 503);
    return role.data ? null : json({ error: 'Administrator access required' }, 403);
  } catch { return json({ error: 'Authentication service unavailable' }, 503); }
}
export function secretMatches(value: string | null, secret: string | undefined): boolean {
  if (!value || !secret) return false;
  const a = Buffer.from(value); const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function requireIngest(request: Request): Response | null {
  if (!process.env.TRACKER_INGEST_SECRET) return json({ error: 'GPS ingestion is not configured' }, 503);
  return secretMatches(request.headers.get('authorization')?.replace(/^Bearer /i, '') ?? null, process.env.TRACKER_INGEST_SECRET)
    ? null : json({ error: 'Unauthorized gateway' }, 401);
}
