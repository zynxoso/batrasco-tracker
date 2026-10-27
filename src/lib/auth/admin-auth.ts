import { supabaseBrowser } from './supabase-browser';
export async function isFleetAdminAuthorized(): Promise<boolean> {
  if (!supabaseBrowser) return false;
  const { data, error } = await supabaseBrowser.rpc('is_fleet_admin');
  return !error && data === true;
}
export async function verifyAndAuthorizeAdmin(email: string, password: string): Promise<boolean> {
  if (!supabaseBrowser) throw new Error('Admin sign-in is not configured yet.');
  const { error } = await supabaseBrowser.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error('Unable to sign in. Check your email and password.');
  if (await isFleetAdminAuthorized()) return true;
  await supabaseBrowser.auth.signOut();
  throw new Error('This account does not have fleet administrator access.');
}
export async function adminHeaders(): Promise<Record<string, string>> {
  const session = await supabaseBrowser?.auth.getSession();
  const token = session?.data.session?.access_token;
  if (!token) throw new Error('Please sign in again.');
  return { Authorization: `Bearer ${token}` };
}
