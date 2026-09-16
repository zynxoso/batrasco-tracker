import { Bus, Clock3, MapPin, Signal, SignalLow, Wifi, WifiOff } from 'lucide-react';
import type { Vehicle } from '../../App';
import { UiverseToggle } from '../ui/UiverseToggle';
import { cn } from '../ui/utils';

type TrackerVehicleSidebarProps = {
  vehicles: Vehicle[];
  selectedVehicleId: string | null;
  gpsVehicleIds: Set<string>;
  toggleBusyId: string | null;
  onSelectVehicle: (vehicleId: string) => void;
  onToggleIngest: (vehicleId: string, enabled: boolean) => void;
};

function formatShortTime(value?: string) {
  if (!value) return 'No signal';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export function TrackerVehicleSidebar({
  vehicles,
  selectedVehicleId,
  gpsVehicleIds,
  toggleBusyId,
  onSelectVehicle,
  onToggleIngest,
}: TrackerVehicleSidebarProps) {
  const enabledCount = vehicles.filter((vehicle) => vehicle.ingestEnabled !== false).length;
  const offlineCount = vehicles.filter((vehicle) => vehicle.status !== 'online').length;

  return (
    <aside className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] text-slate-100 shadow-[0_30px_80px_-40px_rgba(2,6,23,0.95)]">
      <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_45%),linear-gradient(180deg,rgba(15,23,42,0.82),rgba(15,23,42,0.48))] px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-blue-400/30 bg-blue-500/15 p-2 text-blue-200 shadow-[0_0_30px_-12px_rgba(56,189,248,0.85)]">
            <Bus className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">Fleet Rail</p>
            <h2 className="truncate text-base font-bold text-white">Tracker Selection</h2>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5">
            <div className="text-lg font-black text-white">{vehicles.length}</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Fleet</div>
          </div>
          <div className="rounded-2xl border border-blue-400/20 bg-blue-500/10 px-3 py-2.5">
            <div className="text-lg font-black text-blue-200">{gpsVehicleIds.size}</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-100/80">GPS</div>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2.5">
            <div className="text-lg font-black text-emerald-200">{enabledCount}</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100/80">Tracking</div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-2xl border border-white/10 bg-black/15 px-3 py-2 text-[11px] text-slate-300">
          <span>{offlineCount} offline</span>
          <span>{Math.max(vehicles.length - offlineCount, 0)} reporting</span>
        </div>
      </div>

      {vehicles.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-white/15 bg-white/5 text-slate-400">
            <Bus className="h-5 w-5" aria-hidden />
          </div>
          <p className="mt-4 text-sm font-medium text-slate-200">No vehicles available</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">Devices will appear here once the tracker feed starts reporting.</p>
        </div>
      ) : (
        <ul
          className="max-h-[calc(100dvh-15.5rem)] space-y-2 overflow-y-auto px-3 py-3"
          aria-label="Vehicle tracker sidebar"
        >
          {vehicles.map((vehicle) => {
            const selected = selectedVehicleId === vehicle.id;
            const ingestOn = vehicle.ingestEnabled !== false;
            const hasGps = gpsVehicleIds.has(vehicle.id);
            const hasNamedDriver =
              Boolean(vehicle.driver?.trim()) && vehicle.driver!.trim() !== '-';
            const driverLabel = hasNamedDriver ? vehicle.driver!.trim() : null;

            return (
              <li key={vehicle.id}>
                {/* div+role="button": row must not wrap a real <button> — UiverseToggle is a button inside. */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={`Select ${vehicle.plateNumber}, device ID ${vehicle.id}, on map`}
                  onClick={() => onSelectVehicle(vehicle.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectVehicle(vehicle.id);
                    }
                  }}
                  className={cn(
                    'group relative w-full cursor-pointer overflow-hidden rounded-[24px] border p-3 text-left transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
                    selected
                      ? 'border-blue-400/40 bg-[linear-gradient(135deg,rgba(72,77,128,0.22),rgba(15,23,42,0.92)_55%,rgba(2,6,23,0.96))] shadow-[0_24px_45px_-28px_rgba(72,77,128,0.85)]'
                      : 'border-white/8 bg-white/[0.035] hover:border-blue-400/20 hover:bg-blue-400/[0.06]'
                  )}
                >
                  <div
                    className={cn(
                      'absolute inset-y-3 left-0 w-1 rounded-r-full transition-colors',
                      selected ? 'bg-blue-300 shadow-[0_0_20px_rgba(174,181,217,0.95)]' : 'bg-transparent'
                    )}
                  />

                  <div className="flex items-start justify-between gap-3 pl-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-white">{vehicle.plateNumber}</div>
                      {driverLabel ? <div className="truncate text-xs text-slate-400">{driverLabel}</div> : null}
                      <div
                        className="mt-0.5 truncate text-[10px] leading-snug text-slate-500"
                        title="SinoTrack / tracker device identifier (IMEI)"
                      >
                        Device ID{' '}
                        <span className="font-mono text-slate-300 tabular-nums">{vehicle.id}</span>
                      </div>
                    </div>
                    <div
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]',
                        vehicle.status === 'online'
                          ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
                          : 'border-white/10 bg-white/5 text-slate-300'
                      )}
                    >
                      {vehicle.status}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 pl-2 text-[11px]">
                    <div
                      className={cn(
                        'rounded-2xl border px-3 py-2',
                        hasGps
                          ? 'border-blue-400/20 bg-blue-500/10 text-blue-100'
                          : 'border-white/10 bg-white/5 text-slate-300'
                      )}
                    >
                      <div className="flex items-center gap-1.5 font-semibold">
                        <MapPin className="h-3.5 w-3.5" aria-hidden />
                        {hasGps ? 'GPS locked' : 'No GPS'}
                      </div>
                      <div className="mt-1 text-[10px] text-current/70">
                        {hasGps ? 'Ready for map focus' : 'Awaiting coordinates'}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-slate-300">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <Clock3 className="h-3.5 w-3.5" aria-hidden />
                        Last report
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400">{formatShortTime(vehicle.lastUpdated)}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3 rounded-[20px] border border-white/10 bg-black/20 px-3 py-2.5 pl-5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        {ingestOn ? (
                          <Signal className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
                        ) : (
                          <SignalLow className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                        )}
                        Tracking
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-200">
                        {vehicle.status === 'online' ? (
                          <Wifi className="h-3.5 w-3.5 text-blue-300" aria-hidden />
                        ) : (
                          <WifiOff className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                        )}
                        {ingestOn ? 'Active' : 'Paused'}
                      </div>
                    </div>

                    <div
                      className="relative z-[1]"
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <UiverseToggle
                        checked={ingestOn}
                        disabled={toggleBusyId === vehicle.id}
                        onCheckedChange={(enabled) => onToggleIngest(vehicle.id, enabled)}
                        aria-label={`Turn tracking ${ingestOn ? 'off' : 'on'} for ${vehicle.plateNumber}`}
                      />
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
