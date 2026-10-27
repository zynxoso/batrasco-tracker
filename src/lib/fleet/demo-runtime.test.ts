import { describe, expect, it, vi, afterEach } from 'vitest';
import { DemoRuntime, demoRuntime, setDemoMode } from './demo-runtime';
import { DEFAULT_ROUTE_ID } from './registry';
import { fetchVehicles, fetchTrackerHistory, setVehicleIngestEnabled, setVehicleScrapeIntervalMs, setCronTrackingEnabled } from '../../api/client';

const mutate = (runtime: DemoRuntime, entity: string, record: any, id?: string) => runtime.request('/api/fleet-registry', { method: id ? 'PATCH' : 'POST', body: JSON.stringify({entity, record, id}) });
afterEach(()=>vi.unstubAllGlobals());
describe('existing-screen demo adapter',()=>{
  it('loads all ten unit labels, retaining leading zeros',()=>{
    const r=new DemoRuntime();expect(r.vehicles().map(v=>v.plateNumber)).toEqual(['68','10','09','07','71','05','69','87','02','06']);
    expect(new Set(r.vehicles().map(v=>v.deviceId)).size).toBe(10);
  });
  it('upgrades the old saved roster once without resetting edits, progress or history',()=>{
    const values=new Map<string,string>();const storage={getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>{values.set(k,v);}};
    const old=new DemoRuntime(storage);old.advance(1);old.setPlaying(false);
    old.state.records.vehicles=old.state.records.vehicles.slice(0,3);
    old.state.records.vehicles.forEach((row,i)=>{row.plate_number=`DEMO-0${i+1}`;});
    old.state.records.vehicles[1].plate_number='CUSTOM';old.state.records.vehicles[0].capacity=35;old.save();
    const id=old.vehicles()[0].id, history=old.history(id,100), seconds=old.state.units[id].seconds;
    const loaded=new DemoRuntime(storage);expect(loaded.vehicles()).toHaveLength(10);
    expect(loaded.vehicles()[0].plateNumber).toBe('68');expect(loaded.vehicles()[0].capacity).toBe(35);
    expect(loaded.vehicles()[1].plateNumber).toBe('CUSTOM');expect(loaded.state.units[id].seconds).toBe(seconds);
    expect(loaded.state.playing).toBe(false);expect(loaded.history(id,100)).toEqual(history);
    expect(new DemoRuntime(storage).vehicles()).toHaveLength(10);
  });
  it('moves vehicles, freezes on pause, resumes and records route points',()=>{
    const r = new DemoRuntime(); const start=r.vehicles()[1];
    r.advance(1); expect(r.vehicles()[1].latitude).not.toBe(start.latitude);
    const paused=r.vehicles()[1].latitude; r.setPlaying(false); r.advance(1);
    expect(r.vehicles()[1].latitude).toBe(paused); expect(r.vehicles()[1].speed).toBe(0);
    r.setPlaying(true);r.advance(1);expect(r.vehicles()[1].latitude).not.toBe(paused);
    expect(r.history(start.id,100).length).toBeGreaterThan(1);
  });
  it('per-unit tracking freezes only that unit and interval controls history sampling',()=>{
    const r=new DemoRuntime();const [a,b]=r.vehicles(); r.setUnit(a.id,{enabled:false});
    r.setUnit(b.id,{interval:60000});const count=r.history(b.id,100).length;
    r.advance(1);expect(r.vehicles()[0].latitude).toBe(a.latitude);expect(r.vehicles()[0].status).toBe('offline');
    expect(r.vehicles()[1].latitude).not.toBe(b.latitude);expect(r.history(b.id,100)).toHaveLength(count);
    r.advance(1);r.advance(1);expect(r.history(b.id,100)).toHaveLength(count+1);
  });
  it('record changes update fleet data and survive a new browser session',async()=>{
    const values=new Map<string,string>();const storage={getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>{values.set(k,v);}};
    const r=new DemoRuntime(storage);const row=r.state.records.vehicles[0];
    await mutate(r,'vehicles',{...row,plate_number:'DEMO-EDIT',capacity:35},row.id);
    const reloaded=new DemoRuntime(storage);expect(reloaded.vehicles()[0].plateNumber).toBe('DEMO-EDIT');expect(reloaded.vehicles()[0].capacity).toBe(35);
    await mutate(r,'drivers',{name:'Sample Driver',phone:''});
    const driver=r.state.records.drivers.at(-1)!;await mutate(r,'vehicles',{...row,driver_id:driver.id},row.id);
    expect(r.vehicles()[0].driver).toBe('Sample Driver');
  });
  it('archives and restores fleet records without deleting history',async()=>{
    const r=new DemoRuntime();const row=r.state.records.vehicles[0];
    for(const archived of [true,false]){
      await r.request('/api/fleet-registry',{method:'PATCH',body:JSON.stringify({entity:'vehicles',id:row.id,archived})});
      expect(r.vehicles().some(v=>v.id===row.id)).toBe(!archived);
    }
    expect(r.history(row.id,10).length).toBeGreaterThan(0);
  });
  it('adds a vehicle to the map and applies station edits to its trip',async()=>{
    const r=new DemoRuntime();await mutate(r,'vehicles',{plate_number:'DEMO-04',route_id:DEFAULT_ROUTE_ID,capacity:20,availability:'active'});
    expect(r.vehicles()).toHaveLength(11); const station=r.state.records.stations[1];
    await mutate(r,'stations',{...station,name:'Sample middle stop'},station.id);
    expect(r.stations().some(s=>s.name==='Sample middle stop')).toBe(true);
    expect(r.vehicles()[0].etaInDirectionOfTravel).toContain('Sample middle stop');
  });
  it('can register and run another route along the existing corridor',async()=>{
    const r=new DemoRuntime();await mutate(r,'routes',{code:'DEMO-NEW',name:'Demo branch',origin:'Batangas',destination:'Lipa'});
    const route=r.state.records.routes.at(-1)!;
    for(const row of r.state.records.stations.slice(0,2))await mutate(r,'stations',{...row,route_id:route.id});
    await mutate(r,'vehicles',{plate_number:'BRANCH-01',route_id:route.id,capacity:20,availability:'active'});
    r.setRoute(route.id);expect(r.stations()).toHaveLength(2);expect(r.vehicles()).toHaveLength(1);expect(r.vehicles()[0].status).toBe('online');
  });
  it('rejects duplicate records and bad assignments',async()=>{
    const r=new DemoRuntime();await expect(mutate(r,'vehicles',{...r.state.records.vehicles[0]})).rejects.toThrow('already exists');
    await expect(mutate(r,'vehicles',{...r.state.records.vehicles[0],plate_number:'NEW',device_id:null,driver_id:'00000000-0000-4000-8000-000000000099'})).rejects.toThrow('active assignment');
  });
  it('bounds history and restart preserves edits while reset restores sample records',async()=>{
    const r=new DemoRuntime();r.setRate(60);for(let i=0;i<300;i++)r.advance(1);
    expect(r.history(r.vehicles()[0].id,1000).length).toBeLessThanOrEqual(240);
    const row=r.state.records.drivers[0];await mutate(r,'drivers',{...row,name:'Edited'},row.id);
    r.restart();expect(r.state.records.drivers[0].name).toBe('Edited');expect(r.state.elapsed).toBe(0);
    r.reset();expect(r.state.records.drivers[0].name).toBe('Demo Driver 1');
  },15000);
  it('all demo client operations avoid network/auth calls',async()=>{
    const network=vi.fn(()=>{throw new Error('Demo must not call network');});vi.stubGlobal('fetch',network);
    setDemoMode(true);demoRuntime.reset();const id=demoRuntime.vehicles()[0].id;
    await fetchVehicles();await fetchTrackerHistory(id);await setVehicleIngestEnabled(id,false);
    await setVehicleScrapeIntervalMs(id,30000);await setCronTrackingEnabled(false);
    expect(network).not.toHaveBeenCalled();demoRuntime.reset();
  });
});
