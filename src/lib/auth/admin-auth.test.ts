import { describe, it, expect, vi, beforeEach } from 'vitest';
const client=vi.hoisted(()=>({rpc:vi.fn(),auth:{signInWithPassword:vi.fn(),signOut:vi.fn(),getSession:vi.fn()}}));
vi.mock('./supabase-browser',()=>({supabaseBrowser:client}));
import { verifyAndAuthorizeAdmin, isFleetAdminAuthorized, adminHeaders } from './admin-auth';
beforeEach(()=>{vi.resetAllMocks();});
describe('administrator session',()=>{
  it('rejects a valid account without an administrator role',async()=>{
    client.auth.signInWithPassword.mockResolvedValue({error:null});client.rpc.mockResolvedValue({data:false,error:null});
    await expect(verifyAndAuthorizeAdmin('operator@example.test','test-password')).rejects.toThrow('administrator');
    expect(client.auth.signOut).toHaveBeenCalledOnce();
  });
  it('requires a successful role check after login',async()=>{
    client.auth.signInWithPassword.mockResolvedValue({error:null});client.rpc.mockResolvedValue({data:true,error:null});
    await expect(verifyAndAuthorizeAdmin(' admin@example.test ','test-password')).resolves.toBe(true);
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({email:'admin@example.test',password:'test-password'});
  });
  it('fails closed if role lookup fails',async()=>{client.rpc.mockResolvedValue({data:null,error:{message:'unavailable'}});expect(await isFleetAdminAuthorized()).toBe(false);});
  it('does not authorize a missing browser session',async()=>{client.auth.getSession.mockResolvedValue({data:{session:null}});await expect(adminHeaders()).rejects.toThrow('sign in');});
});
