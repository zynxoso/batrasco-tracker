import { useMemo, useState } from 'react';
import type { Vehicle } from '../../App';
import { ListOrdered, Users } from 'lucide-react';
import { buildHeadwayRows, formatHeadwayTime, type HeadwayRow } from '../../lib/fleet/vehicle-headway';

/** Default: who reaches the end first. Then sort by time-to-next-vehicle (asc = tightest). */
type TableSort = 'arrival' | 'time_asc' | 'time_desc';

type VehicleConvoyHeadwayPanelProps = {
  vehicles: Vehicle[];
  /** When true, render only the tables (no outer card + title). */
  embedded?: boolean;
};

function applyTableSort(base: HeadwayRow[], sort: TableSort): HeadwayRow[] {
  if (sort === 'arrival') return base;
  const order: 'asc' | 'desc' = sort === 'time_asc' ? 'asc' : 'desc';
  const copy = [...base];
  copy.sort((a, b) => {
    const av = a.minutesToNext;
    const bv = b.minutesToNext;
    if (av == null && bv == null) return a.arrivalOrder - b.arrivalOrder;
    if (av == null) return 1;
    if (bv == null) return -1;
    const d = av - bv;
    return order === 'asc' ? d : -d;
  });
  return copy;
}

function nextSort(s: TableSort): TableSort {
  if (s === 'arrival') return 'time_asc';
  if (s === 'time_asc') return 'time_desc';
  return 'arrival';
}

function sortButtonLabel(s: TableSort): string {
  if (s === 'arrival') return 'Arrival order';
  if (s === 'time_asc') return 'Gap: short → long';
  return 'Gap: long → short';
}

function HeadwayTable({
  title,
  subtitle,
  rows,
  sort,
  onCycleSort,
}: {
  title: string;
  subtitle: string;
  rows: HeadwayRow[];
  sort: TableSort;
  onCycleSort: () => void;
}) {
  const leadCount = rows.filter((r) => r.isLead).length;
  const withGapCount = rows.filter((r) => r.minutesToNext != null).length;

  if (rows.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/90 px-4 py-3">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-slate-900">{title}</h3>
              <p className="mt-0.5 text-xs text-slate-600">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onCycleSort}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#253272]/40"
              title="Cycle: arrival order → shortest gap first → longest gap first"
              aria-label={`Sort: ${sortButtonLabel(sort)}. Click for next mode.`}
            >
              <ListOrdered className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
              {sortButtonLabel(sort)}
            </button>
          </div>
        </div>
        <div className="px-4 py-5 text-center text-sm text-slate-500">No online vehicles currently on this heading.</div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/90 px-4 py-3">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-slate-900">{title}</h3>
            <p className="mt-0.5 text-xs text-slate-600">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onCycleSort}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#253272]/40"
            title="Cycle: arrival order → shortest gap first → longest gap first"
            aria-label={`Sort: ${sortButtonLabel(sort)}. Click for next mode.`}
          >
            <ListOrdered className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
            {sortButtonLabel(sort)}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5">
            Vehicles: <strong className="ml-1 font-semibold text-slate-900">{rows.length}</strong>
          </span>
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5">
            Leads: <strong className="ml-1 font-semibold text-slate-900">{leadCount}</strong>
          </span>
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5">
            With gap: <strong className="ml-1 font-semibold text-slate-900">{withGapCount}</strong>
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[360px] text-left text-xs sm:text-sm">
          <thead>
            <tr className="sticky top-0 z-[1] border-b border-slate-100 bg-white/95 text-slate-600 backdrop-blur">
              <th className="px-3 py-2.5 font-semibold sm:px-4" title="1 = first to reach the end of the line on this heading">
                Order
              </th>
              <th className="px-3 py-2.5 font-semibold sm:px-4">Unit</th>
              <th className="hidden px-3 py-2.5 text-right font-semibold sm:table-cell sm:px-4">Route %</th>
              <th className="px-3 py-2.5 text-right font-semibold sm:px-4">Time ahead</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.vehicle.id}
                className="border-b border-slate-50 last:border-0 odd:bg-white even:bg-slate-50/40 hover:bg-slate-100/60"
              >
                <td className="px-3 py-2.5 font-mono tabular-nums text-slate-700 sm:px-4">{r.arrivalOrder}</td>
                <td className="px-3 py-2.5 font-semibold text-slate-900 sm:px-4">Unit {r.vehicle.plateNumber}</td>
                <td className="hidden px-3 py-2.5 text-right font-mono tabular-nums text-slate-600 sm:table-cell sm:px-4">
                  {r.vehicle.currentPosition.toFixed(1)}%
                </td>
                <td className="px-3 py-2.5 text-right text-slate-800 sm:px-4">
                  {r.isLead ? (
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      Lead
                    </span>
                  ) : r.minutesToNext != null ? (
                    <span
                      className="font-semibold tabular-nums text-slate-900"
                      title={`${r.gapKm.toFixed(2)} km`}
                    >
                      {formatHeadwayTime(r.minutesToNext)}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * When no single vehicle is selected: show all on-route convoys, time gap to
 * the next vehicle *ahead* in the same direction (Lipa vs Batangas), default
 * order = who finishes the run first; optional sort on “time to vehicle
 * ahead” (asc = tightest follow, desc = largest gap).
 */
export function VehicleConvoyHeadwayPanel({ vehicles, embedded = false }: VehicleConvoyHeadwayPanelProps) {
  const trackingVehicles = useMemo(
    () => vehicles.filter((v) => v.ingestEnabled !== false),
    [vehicles]
  );
  const toLipaBase = useMemo(() => buildHeadwayRows(trackingVehicles, true), [trackingVehicles]);
  const toBatBase = useMemo(() => buildHeadwayRows(trackingVehicles, false), [trackingVehicles]);

  const [sortLipa, setSortLipa] = useState<TableSort>('arrival');
  const [sortBat, setSortBat] = useState<TableSort>('arrival');

  const toLipaRows = useMemo(() => applyTableSort(toLipaBase, sortLipa), [toLipaBase, sortLipa]);
  const toBatRows = useMemo(() => applyTableSort(toBatBase, sortBat), [toBatBase, sortBat]);

  const content = (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0">
        <HeadwayTable
          title="Going to J.P. Laurel (east)"
          subtitle="1st row = first to reach the Lipa / SM end of the line; “time ahead” = to the bus in front, toward Lipa."
          rows={toLipaRows}
          sort={sortLipa}
          onCycleSort={() => setSortLipa(nextSort)}
        />
      </div>
      <div className="min-w-0">
        <HeadwayTable
          title="Going to Palico (west)"
          subtitle="1st row = first to reach the Batangas / Palico end; “time ahead” = to the bus in front, toward Palico."
          rows={toBatRows}
          sort={sortBat}
          onCycleSort={() => setSortBat(nextSort)}
        />
      </div>
    </div>
  );

  if (embedded) return content;

  return (
    <section
      className="w-full min-w-0 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-900/5 sm:p-5"
      aria-label="Time between vehicles on the same heading"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
          <Users className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-slate-900 sm:text-lg">Convoy spacing</h2>
          <p className="text-xs text-slate-600 sm:text-sm">
            Time from each vehicle to the <strong>next one ahead</strong> along the line (at its current speed). Lead
            has no one ahead. Sort the last column to compare short vs long headways.
          </p>
        </div>
      </div>
      {content}
    </section>
  );
}
