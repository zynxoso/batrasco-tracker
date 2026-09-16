import type { StationLegRecord } from '../../lib/fleet/station-leg-tracker';
import { directionLabel, formatLegDurationMinutesRounded, formatLegDurationMs } from '../../lib/fleet/station-leg-tracker';
import { Timer } from 'lucide-react';

type StationLegTimesPanelProps = {
  records: StationLegRecord[];
  compact?: boolean;
  tone?: 'dark' | 'light';
  /** Hide the explanatory paragraph (useful in modals). */
  showIntro?: boolean;
};

/**
 * Last completed inter-stop runs (1→2, 2→3 eastbound or 3→2, 2→1 westbound in
 * route order — same numbering as the strip: 1=Palico, 2=Mak, 3=J.P. Laurel).
 */
export function StationLegTimesPanel({
  records,
  compact = false,
  tone = 'dark',
  showIntro = true,
}: StationLegTimesPanelProps) {
  const recent = records.slice(0, compact ? 6 : 12);
  const dark = tone === 'dark';

  return (
    <div
      className={
        dark
          ? compact
            ? 'mb-3 w-full min-w-0 rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-white'
            : 'mb-3 w-full min-w-0 rounded-xl border border-white/20 bg-white/10 px-3 py-3 text-white sm:mb-4 sm:px-4 sm:py-3.5'
          : compact
            ? 'mb-0 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-800 shadow-sm'
            : 'mb-0 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 text-slate-800 shadow-sm sm:px-4 sm:py-3.5'
      }
    >
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <div
          className={
            dark
              ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/20'
              : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700'
          }
        >
          <Timer className="h-3.5 w-3.5" aria-hidden />
        </div>
        <h3
          className={
            compact
              ? `min-w-0 text-xs font-bold leading-tight ${dark ? 'text-white' : 'text-slate-900'}`
              : `min-w-0 text-sm font-bold leading-tight ${dark ? 'text-white' : 'text-slate-900'} sm:text-base`
          }
        >
          Station-to-station travel times
        </h3>
        <p className={dark ? 'ml-auto text-[9px] font-medium text-white/60 sm:text-[10px]' : 'ml-auto text-[9px] font-medium text-slate-500 sm:text-[10px]'}>
          From live GPS
        </p>
      </div>
      {showIntro ? (
        <p
          className={
            dark ? 'mb-2 text-[10px] leading-snug text-white/75 sm:text-xs' : 'mb-2 text-[10px] leading-snug text-slate-600 sm:text-xs'
          }
        >
          We record when a vehicle <strong>leaves</strong> a stop and <strong>arrives</strong> at the next one along its
          direction (1→2→3 toward J.P. Laurel, 3→2→1 back toward Palico). Times are along the real corridor, not
          straight-line.
        </p>
      ) : null}
      {recent.length === 0 ? (
        <p className={dark ? 'text-[11px] text-white/70 sm:text-xs' : 'text-[11px] text-slate-600 sm:text-xs'}>
          No station legs recorded yet.
        </p>
      ) : (
        <ul
          className={`max-h-[min(220px,40vh)] list-none space-y-1.5 overflow-y-auto pr-0.5 ${
            compact ? 'text-[10px]' : 'text-[11px] sm:text-xs'
          }`}
          aria-label="Recent station to station times"
        >
          {recent.map((r) => (
            <li
              key={r.id}
              className={
                dark
                  ? 'flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg bg-white/10 px-2 py-1.5'
                  : 'flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5'
              }
            >
              <span className={dark ? 'font-semibold tabular-nums text-white/95' : 'font-semibold tabular-nums text-slate-900'}>
                {r.plateNumber}
              </span>
              <span className={dark ? 'text-white/90' : 'text-slate-700'}>
                Stop {r.fromOrder} → {r.toOrder}
                <span className={dark ? 'ml-1 text-white/50' : 'ml-1 text-slate-400'}>·</span>
                <span
                  className={dark ? 'ml-1 font-medium text-white' : 'ml-1 font-medium text-slate-900'}
                  title={formatLegDurationMs(r.durationMs)}
                >
                  {formatLegDurationMinutesRounded(r.durationMs)}
                </span>
              </span>
              <span
                className={dark ? 'w-full pl-0 text-white/60 sm:ml-0 sm:w-auto' : 'w-full pl-0 text-slate-500 sm:ml-0 sm:w-auto'}
                title={r.fromLabel + ' → ' + r.toLabel}
              >
                {directionLabel(r.direction)} · {new Date(r.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
