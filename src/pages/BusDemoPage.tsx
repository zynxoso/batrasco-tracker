import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bus, MapPin, Pause, Play, RotateCcw, LocateFixed, ArrowRight } from 'lucide-react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { demoBuses, demoRouteKm, demoRoutePath, demoStops, sampleBus, type DemoBusState } from '../lib/demo/bus-simulation';
import './bus-demo.css';

const bounds = L.latLngBounds(demoRoutePath);
const icons = demoBuses.map(bus => L.divIcon({
  className: 'demo-bus-icon', iconSize: [38, 38], iconAnchor: [19, 19],
  html: `<div style="background:${bus.color}"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><rect x="5" y="3" width="14" height="16" rx="3"/><path d="M5 11h14M8 19v3M16 19v3M8 6h8"/><circle cx="8.5" cy="15" r="1"/><circle cx="15.5" cy="15" r="1"/></svg></div>`,
}));

function Camera({ bus, follow, reset }: { bus: DemoBusState; follow: boolean; reset: number }) {
  const map = useMap();
  useEffect(() => { map.fitBounds(bounds, { padding: [35, 35] }); }, [map, reset]);
  useEffect(() => {
    if (follow) map.panTo(bus.coordinates, { animate: false });
  }, [map, follow, bus.coordinates[0], bus.coordinates[1]]);
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

function duration(seconds: number) {
  const rounded = Math.ceil(Math.max(0, seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

export default function BusDemoPage() {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(20);
  const [selectedId, setSelectedId] = useState(demoBuses[0].id);
  const [follow, setFollow] = useState(false);
  const [reset, setReset] = useState(0);
  const [tileError, setTileError] = useState(false);
  const lastTick = useRef(0);
  useEffect(() => {
    if (!playing) return;
    lastTick.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = (now - lastTick.current) / 1000;
      lastTick.current = now;
      // Background tabs pause the demo instead of jumping through whole trips.
      if (!document.hidden) setElapsed(value => value + Math.min(delta, 1) * rate);
    }, 250);
    return () => window.clearInterval(timer);
  }, [playing, rate]);
  const buses = useMemo(() => demoBuses.map(bus => sampleBus(elapsed, bus)), [elapsed]);
  const selected = buses.find(bus => bus.id === selectedId)!;

  function restart() { setElapsed(0); setPlaying(true); setFollow(false); setReset(value => value + 1); }

  return <main className="bus-demo">
    <div className="demo-disclosure"><strong>DEMO MODE · SIMULATED GPS</strong><span>All bus locations, speeds and arrivals on this page are generated for demonstration.</span></div>
    <header className="demo-header">
      <div className="demo-brand"><span className="demo-brand-icon"><Bus size={25} /></span><div><strong>BATRASCO</strong><span>Interactive route demo</span></div></div>
      <Link to="/">Back to main site <ArrowRight size={16} /></Link>
    </header>
    <section className="demo-title"><div><p className="demo-eyebrow">BATANGAS CITY / SAN JOSE / LIPA CITY</p><h1>Follow the journey.</h1><p>Watch sample buses travel the route, stop at stations and head back.</p></div><span className={`demo-running ${playing ? '' : 'is-paused'}`}><i />{playing ? 'Simulation running' : 'Simulation paused'}</span></section>
    <section className="demo-controls" aria-label="Simulation controls">
      <button className="demo-primary" onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={17} /> : <Play size={17} />}{playing ? 'Pause demo' : 'Resume demo'}</button>
      <button onClick={restart}><RotateCcw size={16} />Restart</button>
      <label>Playback <select value={rate} onChange={event => setRate(Number(event.target.value))}><option value={1}>1× real time</option><option value={20}>20× faster</option><option value={60}>60× faster</option></select></label>
      <span className="demo-clock">Demo time <strong>{duration(elapsed)}</strong></span>
      <p>Speed and ETA use simulated time. At {rate}×, 1 second advances {rate} simulation seconds.</p>
    </section>
    <div className="demo-workspace">
      <section className="demo-map-panel" aria-label="Simulated bus map">
        <div className="demo-panel-heading"><div><h2>Route map</h2><p>{demoRouteKm.toFixed(1)} km · 3 sample buses · 3 stations</p></div><button onClick={() => { setFollow(false); setReset(value => value + 1); }}>Show full route</button></div>
        <div className="demo-map">
          <MapContainer bounds={bounds} boundsOptions={{ padding: [35, 35] }} scrollWheelZoom className="demo-leaflet">
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' eventHandlers={{ tileerror: () => setTileError(true), tileload: () => setTileError(false) }} />
            <Polyline positions={demoRoutePath} pathOptions={{ color: '#087f6b', weight: 5, opacity: 0.75 }} />
            {demoStops.map(stop => <CircleMarker key={stop.id} center={[stop.latitude, stop.longitude]} radius={8} pathOptions={{ color: '#153a37', fillColor: 'white', fillOpacity: 1, weight: 3 }}><Tooltip>{stop.name}</Tooltip></CircleMarker>)}
            {buses.map((bus, index) => <Marker key={bus.id} position={bus.coordinates} icon={icons[index]} zIndexOffset={bus.id === selectedId ? 1000 : 0} eventHandlers={{ click: () => setSelectedId(bus.id) }}><Tooltip permanent direction="top" offset={[0, -20]}>{bus.name} · {bus.stopped ? 'At station' : `${bus.speed} km/h`} · Demo</Tooltip></Marker>)}
            <Camera bus={selected} follow={follow} reset={reset} />
          </MapContainer>
          <span className="demo-map-label">SIMULATED LOCATIONS</span>
          <button className="demo-follow" aria-pressed={follow} onClick={() => setFollow(value => !value)}><LocateFixed size={17} />{follow ? `Following ${selected.name}` : `Follow ${selected.name}`}</button>
          {tileError && <p className="demo-tile-error">Map tiles unavailable. Route movement and the progress view still work.</p>}
        </div>
        <div className="demo-route-progress" aria-label="Bus progress along route">
          <div className="demo-progress-track">{demoStops.map(stop => <span className="demo-stop-dot" key={stop.id} style={{ left: `${stop.km / demoRouteKm * 100}%` }} title={stop.name} />)}{buses.map((bus, index) => <button key={bus.id} title={`Select ${bus.name}`} aria-label={`Select ${bus.name} on route`} onClick={() => setSelectedId(bus.id)} style={{ left: `${bus.km / demoRouteKm * 100}%`, top: index * 25 - 10, background: bus.color }}><Bus size={15} />{index + 1}</button>)}</div>
          <div className="demo-route-labels"><span>Batangas City</span><span>San Jose</span><span>Lipa City</span></div>
        </div>
      </section>
      <aside className="demo-sidebar">
        <section className="demo-fleet"><div className="demo-panel-heading"><h2>Sample fleet</h2><span>3 buses</span></div>{buses.map(bus => <button className={`demo-bus-row ${bus.id === selectedId ? 'is-selected' : ''}`} key={bus.id} aria-pressed={bus.id === selectedId} onClick={() => setSelectedId(bus.id)}><span className="demo-fleet-icon" style={{ color: bus.color }}><Bus size={24} /></span><span><strong>{bus.name} <small>{bus.id}</small></strong><span>{bus.stopped ? `Stopped · ${bus.nextStop.location}` : `To ${bus.direction}`}</span></span><b>{bus.speed}<small>km/h</small></b></button>)}</section>
        <section className="demo-details"><p className="demo-eyebrow">SELECTED BUS · SIMULATED DATA</p><h2>{selected.name}<span>{selected.stopped ? 'At station' : 'On route'}</span></h2><div className="demo-next-stop"><MapPin size={20} /><div><small>{selected.stopped ? 'Current station' : 'Next station'}</small><strong>{selected.nextStop.name}</strong></div></div><div className="demo-metrics"><div><span>{selected.stopped ? 'Departs in' : 'Arrival in'}</span><strong data-testid="demo-eta">{duration(selected.stopped ? selected.departureSeconds : selected.etaSeconds)}</strong><small>simulation min:sec</small></div><div><span>Distance to stop</span><strong>{selected.remainingKm.toFixed(2)} <small>km</small></strong></div></div><p className="demo-coordinates" data-testid="demo-coordinates">{selected.coordinates[0].toFixed(6)}, {selected.coordinates[1].toFixed(6)}</p><p className="demo-note">Buses wait 45 simulation seconds at each station and turn around at the end of the route.</p></section>
      </aside>
    </div>
    <footer className="demo-footer">Demo runs locally in your browser. No SinoTrack device is connected and no demo positions are saved to the live fleet.</footer>
  </main>;
}
