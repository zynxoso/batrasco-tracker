import { supabaseBrowser } from './supabase-browser';
export async function isFleetAdminAuthorized(): Promise<boolean> {
  if (!supabaseBrowser) return false;
  const { data, error } = await supabaseBrowser.rpc('is_fleet_admin');
  return !error && data === true;
}
export async function verifyAndAuthorizeAdmin(username: string, password: string): Promise<boolean> {
  if (!supabaseBrowser) throw new Error('Admin sign-in is not configured yet.');
  const login = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,64}$/.test(login)) throw new Error('Unable to sign in. Check your username and password.');
  // Supabase validates the password; this internal address only maps the username to its Auth account.
  const { error } = await supabaseBrowser.auth.signInWithPassword({ email: `${login}@fleet.batrasco.internal`, password });
  if (error) throw new Error('Unable to sign in. Check your username and password.');
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
