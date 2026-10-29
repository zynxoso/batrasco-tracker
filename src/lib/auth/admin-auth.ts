const SESSION_KEY = 'batrasco_fleet_authorized';

// Configured credentials for fleet management access
const FLEET_ADMIN_USER = import.meta.env.VITE_FLEET_ADMIN_USER || 'adminBatrasco';
const FLEET_ADMIN_PASS = import.meta.env.VITE_FLEET_ADMIN_PASS || 'Batrasco@admin26';

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    return window.sessionStorage;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).sessionStorage) {
    return (globalThis as any).sessionStorage;
  }
  return null;
}

/**
 * Checks if the current browser session has been unlocked with valid credentials.
 */
export function isFleetAdminAuthorized(): boolean {
  try {
    return getStorage()?.getItem(SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Verifies credentials and grants access for the duration of the browser tab session.
 */
export function verifyAndAuthorizeAdmin(username: string, password: string): boolean {
  const isMatch =
    username.trim() === FLEET_ADMIN_USER && password === FLEET_ADMIN_PASS;

  if (isMatch) {
    try {
      getStorage()?.setItem(SESSION_KEY, 'true');
    } catch (e) {
      console.warn('Could not persist session authorization:', e);
    }
    return true;
  }
  return false;
}
