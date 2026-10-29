import { beforeEach, describe, expect, it } from 'vitest';
import { isFleetAdminAuthorized, verifyAndAuthorizeAdmin } from './admin-auth';

class MockStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, val: string): void {
    this.store.set(key, val);
  }
  clear(): void {
    this.store.clear();
  }
}

describe('admin-auth', () => {
  beforeEach(() => {
    (globalThis as any).sessionStorage = new MockStorage();
  });

  it('starts unauthorized', () => {
    expect(isFleetAdminAuthorized()).toBe(false);
  });

  it('rejects invalid credentials', () => {
    const ok = verifyAndAuthorizeAdmin('wrongUser', 'wrongPass');
    expect(ok).toBe(false);
    expect(isFleetAdminAuthorized()).toBe(false);
  });

  it('rejects correct username with wrong password', () => {
    const ok = verifyAndAuthorizeAdmin('adminBatrasco', 'wrongPass');
    expect(ok).toBe(false);
    expect(isFleetAdminAuthorized()).toBe(false);
  });

  it('accepts correct credentials and persists to sessionStorage', () => {
    const ok = verifyAndAuthorizeAdmin('adminBatrasco', 'Batrasco@admin26');
    expect(ok).toBe(true);
    expect(isFleetAdminAuthorized()).toBe(true);
    expect((globalThis as any).sessionStorage.getItem('batrasco_fleet_authorized')).toBe('true');
  });

  it('trims leading/trailing whitespace on username', () => {
    const ok = verifyAndAuthorizeAdmin('  adminBatrasco  ', 'Batrasco@admin26');
    expect(ok).toBe(true);
    expect(isFleetAdminAuthorized()).toBe(true);
  });
});
