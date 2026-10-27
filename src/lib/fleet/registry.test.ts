import { describe,it,expect } from 'vitest';
import { validateRecord,validEntity } from './registry';
import { isGpsFresh,vehiclePollDelay } from './freshness';
describe('registry input',()=>{
  it('rejects arbitrary table names and inherited properties',()=>{for(const value of ['fleet_admins','__proto__','constructor',null])expect(validEntity(value)).toBe(false);});
  it('normalizes plates and discards permission fields',()=>{const row=validateRecord('vehicles',{plate_number:' ab-123 ',capacity:20,availability:'active',user_id:'x',role:'admin'});expect(row.plate_number).toBe('AB-123');expect(row).not.toHaveProperty('role');});
  it('rejects invalid capacities, assignments and coordinates',()=>{
    expect(()=>validateRecord('vehicles',{plate_number:'A',capacity:0,availability:'active'})).toThrow();
    expect(()=>validateRecord('vehicles',{plate_number:'A',capacity:20,availability:'active',driver_id:'fake'})).toThrow();
    expect(()=>validateRecord('stations',{name:'A',location:'B',route_id:'00000000-0000-4000-8000-000000000001',station_number:1,latitude:91,longitude:121})).toThrow();
  });
});
describe('GPS freshness and polling',()=>{
  it('rejects stale, absent and implausibly future timestamps',()=>{const now=Date.now();expect(isGpsFresh(new Date(now-301000).toISOString(),now)).toBe(false);expect(isGpsFresh(undefined,now)).toBe(false);expect(isGpsFresh(new Date(now+120000).toISOString(),now)).toBe(false);expect(isGpsFresh(new Date(now-1000).toISOString(),now)).toBe(true);});
  it('backs off instead of looping immediately on old data or failures',()=>{expect([0,1,2,3,100].map(vehiclePollDelay)).toEqual([15000,30000,60000,120000,120000]);});
});
