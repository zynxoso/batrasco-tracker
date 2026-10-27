import { useState, useEffect, lazy, Suspense } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { fetchVehicles } from './api/client';
import { stations as defaultStations, type Station } from './data/route-stations';
import { isDeviceOnTrack } from './lib/route/route-corridor';
import { isGpsFresh, vehiclePollDelay } from './lib/fleet/freshness';
import { LiveRouteDashboardPage } from './pages/LiveRouteDashboardPage';
import { LandingPage } from './pages/LandingPage';
import { FleetMapLoginModal } from './components/auth/FleetMapLoginModal';
import { isFleetAdminAuthorized } from './lib/auth/admin-auth';
import { supabaseBrowser } from './lib/auth/supabase-browser';
import { demoRuntime, isDemoMode } from './lib/fleet/demo-runtime';
import batrascoLogo from './assets/batrasco_logo.png';
import './pages/fleet-management.css';
const TrackerSettingsPage = lazy(()=>import('./pages/TrackerSettingsPage').then(m=>({default:m.TrackerSettingsPage})));
const FleetManagementPage = lazy(()=>import('./pages/FleetManagementPage').then(m=>({default:m.FleetManagementPage})));
export { stations } from './data/route-stations';
export type { Station };
export type Vehicle = {
  id: string;
  deviceId?: string;
  plateNumber: string;
  driver: string;
  currentPosition: number;
  speed: number;
  status: 'online' | 'offline';
  passengers: number;
  capacity: number;
  /** Tracker device online (from API/database) */
  trackerOnline?: boolean;
  /** Current position from tracker (for distance to station) */
  latitude?: number;
  longitude?: number;
  /** Remaining distance in km (from API, live update) */
  remainingDistanceKm?: number;
  lastUpdated?: string;
  /** Single ETA in direction of travel (from API), e.g. "12 min to Batangas Grand Terminal" */
  etaInDirectionOfTravel?: string;
  /** From API/DB only — toward Lipa (100%) vs Batangas (0%). Not client poll delta. */
  headingTowardLipa?: boolean;
  /** GPS heading in degrees (0–360) when provided by tracker; refines direction with route bearing. */
  direction?: number;
  /** When false, ingests for this device are ignored on the server. */
  ingestEnabled?: boolean;
  /** Optional per-device scrape interval in ms. */
  scrapeIntervalMs?: number;
  /** When API omits heading: inferred from last vs current position% on poll (weaker than GPS). */
  motionTowardLipa?: boolean;
};


function StationView({ stations, vehicles, selected, onSelect }: {stations:Station[];vehicles:Vehicle[];selected:string|null;onSelect:(id:string|null)=>void}) {
  const {stationId}=useParams();
  if(!stations.some(s=>s.id===stationId))return <Navigate to="/tracker" replace/>;
  return <LiveRouteDashboardPage stations={stations} vehicles={vehicles} selectedVehicle={selected} onVehicleSelect={onSelect} focusedStationId={stationId}/>;
}
export default function App() {
  const location=useLocation();
  const [demo]=useState(isDemoMode);
  const [,setDemoRevision]=useState(0);
  const [vehicles,setVehicles]=useState<Vehicle[]>([]);
  const [stations,setStations]=useState(defaultStations);
  const [selected,setSelected]=useState<string|null>(null);
  const [error,setError]=useState('');const [loading,setLoading]=useState(true);
  const [login,setLogin]=useState(false);const [admin,setAdmin]=useState(false);const [authReady,setAuthReady]=useState(false);
  const [refresh,setRefresh]=useState(0);const [now,setNow]=useState(Date.now());
  const wantsData=location.pathname!=='/' && location.pathname!=='/manage';
  useEffect(()=>{
    if(!demo)return;
    const update=()=>{setVehicles(demoRuntime.vehicles());setStations(demoRuntime.stations());setLoading(false);setError('');setDemoRevision(v=>v+1);};
    const unsubscribe=demoRuntime.subscribe(update); update();
    let last=performance.now();
    const timer=setInterval(()=>{const current=performance.now();const delta=(current-last)/1000;last=current;if(!document.hidden)demoRuntime.advance(delta);},250);
    const save=()=>demoRuntime.save();
    window.addEventListener('pagehide',save);
    return()=>{clearInterval(timer);unsubscribe();save();window.removeEventListener('pagehide',save);};
  },[demo]);
  useEffect(()=>{
    if(demo){setAuthReady(true);return;}
    let active=true;let version=0;
    async function check(){const n=++version; const session=await supabaseBrowser?.auth.getSession(); const allowed=session?.data.session ? await isFleetAdminAuthorized() : false;if(active&&n===version){setAdmin(allowed);setAuthReady(true);}}
    void check();
    const sub=supabaseBrowser?.auth.onAuthStateChange(()=>{setTimeout(()=>{if(active)void check();},0);});
    const timer=setInterval(()=>void check(),60000);
    return()=>{active=false;clearInterval(timer);sub?.data.subscription.unsubscribe();};
  },[demo]);
  useEffect(()=>{
    if(!wantsData||demo)return;
    let active=true;const controller=new AbortController();
    fetch('/api/network',{signal:controller.signal}).then(r=>r.ok?r.json():null).then(data=>{if(active&&Array.isArray(data?.stations))setStations(data.stations);}).catch(()=>{});
    return()=>{active=false;controller.abort();};
  },[wantsData,refresh,demo]);
  useEffect(()=>{
    if(!wantsData||demo)return;
    let stopped=false;let inFlight=false;let failures=0;let timer:ReturnType<typeof setTimeout>;let etag:string|undefined;
    const controller=new AbortController();setLoading(true);
    async function tick(){
      if(stopped||inFlight||document.hidden)return;
      inFlight=true;
      try{
        const result=await fetchVehicles(etag,controller.signal,admin);
        if(stopped)return;
        if(!result.notModified){if(!Array.isArray(result.data))throw new Error('Invalid response');setVehicles(result.data);}
        etag=result.etag;failures=0;setError('');
      }catch{if(!stopped){failures++;setError('Location updates are unavailable. Any previous locations may be out of date.');}}
      finally{inFlight=false;if(!stopped){setLoading(false);setNow(Date.now());timer=setTimeout(()=>void tick(),vehiclePollDelay(failures));}}
    }
    function visible(){clearTimeout(timer);if(!document.hidden)void tick();}
    void tick();document.addEventListener('visibilitychange',visible);
    const freshness=setInterval(()=>setNow(Date.now()),10000);
    return()=>{stopped=true;controller.abort();clearTimeout(timer);clearInterval(freshness);document.removeEventListener('visibilitychange',visible);};
  },[wantsData,refresh,admin,demo]);
  const freshVehicles=demo?vehicles:vehicles.map(v=>{const fresh=v.trackerOnline!==false&&isGpsFresh(v.lastUpdated,now);return {...v,trackerOnline:fresh,status:fresh&&v.status!=='offline'?'online' as const:'offline' as const,speed:fresh?v.speed:0,etaInDirectionOfTravel:fresh?v.etaInDirectionOfTravel:'Unavailable'};});
  const publicVehicles=freshVehicles.filter(v=>v.ingestEnabled!==false&&isDeviceOnTrack(v.latitude,v.longitude)===true);
  const protectedPage=(content:React.ReactNode)=>demo?content:!authReady?<p className="app-loading">Checking session…</p>:admin?content:<div className="app-loading"><h1>Administrator sign-in required</h1><p>Use your fleet administrator email account.</p><button onClick={()=>setLogin(true)}>Sign in</button></div>;
  return <div className="min-h-screen flex flex-col bg-slate-50">
    <nav className="app-nav" aria-label="Main sections"><Link to="/"><img src={batrascoLogo} alt="BATRASCO"/></Link><NavLink to="/tracker">Dashboard</NavLink><NavLink to="/tracker-settings">Fleet map</NavLink><NavLink to="/manage">Manage records</NavLink>{admin?<button onClick={async()=>{await supabaseBrowser?.auth.signOut();setAdmin(false);setVehicles([]);}}>Sign out</button>:<button onClick={()=>setLogin(true)}>Admin sign in</button>}{demo&&<span className="app-mode-badge" title="Positions are generated locally, not received from GPS devices.">Simulated locations</span>}</nav>
    {wantsData&&error&&<div className="app-alert" role="alert">{error}</div>}
    {wantsData&&loading&&<p className="app-loading" role="status">Loading vehicle data…</p>}
    {wantsData&&!loading&&!error&&!freshVehicles.some(v=>v.trackerOnline)&&<div className="app-alert">No vehicles are reporting on this route right now.</div>}
    <FleetMapLoginModal isOpen={login} onClose={()=>setLogin(false)} onSuccess={()=>{setLogin(false);setAdmin(true);setAuthReady(true);setRefresh(v=>v+1);}}/>
    <Suspense fallback={<p className="app-loading">Loading…</p>}><Routes>
      <Route path="/" element={<LandingPage/>}/>
      <Route path="/tracker" element={<div className="live-route-dashboard-shell p-4"><LiveRouteDashboardPage stations={stations} vehicles={publicVehicles} selectedVehicle={selected} onVehicleSelect={setSelected}/></div>}/>
      <Route path="/station/:stationId" element={<div className="live-route-dashboard-shell p-4"><StationView stations={stations} vehicles={publicVehicles} selected={selected} onSelect={setSelected}/></div>}/>
      <Route path="/tracker-settings" element={protectedPage(<div className="relative flex-1 min-h-[75vh]" style={{minHeight:'max(700px, 80vh)'}}><TrackerSettingsPage key={`${demo}-${demoRuntime.state.route}-${refresh}`} demo={demo} stations={stations} vehicles={freshVehicles} onIngestSettingsChanged={()=>{if(!demo)setRefresh(v=>v+1);}}/></div>)}/>
      <Route path="/manage" element={protectedPage(<FleetManagementPage key={`${demo}-${refresh}`} demo={demo}/>)}/>
      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Routes></Suspense>
  </div>;
}
