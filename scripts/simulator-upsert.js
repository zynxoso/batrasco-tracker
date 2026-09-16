/**
 * Shared upsert for simulator scripts. If the project has not applied
 * 20250324_add_heading_toward_lipa_to_tracker_latest.sql, PostgREST returns PGRST204;
 * we retry once without heading_toward_lipa so local runs still work.
 */

let warnedMissingHeadingColumn = false;

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, unknown>[]} rows
 * @returns {Promise<{ error: Error | null }>}
 */
async function upsertTrackerLatestRows(supabase, rows) {
  const { error } = await supabase.from('tracker_latest').upsert(rows, { onConflict: 'device_id' });
  if (!error) return { error: null };

  const msg = String(error.message || '');
  if (error.code === 'PGRST204' && msg.includes('heading_toward_lipa')) {
    const stripped = rows.map(({ heading_toward_lipa, ...rest }) => rest);
    const { error: err2 } = await supabase
      .from('tracker_latest')
      .upsert(stripped, { onConflict: 'device_id' });
    if (!err2) {
      if (!warnedMissingHeadingColumn) {
        warnedMissingHeadingColumn = true;
        console.warn(
          '[simulator] `heading_toward_lipa` not in DB; upserts omit it. Add the column: run supabase/migrations/20250324_add_heading_toward_lipa_to_tracker_latest.sql in Supabase SQL Editor.'
        );
      }
      return { error: null };
    }
    return { error: err2 };
  }
  return { error };
}

module.exports = { upsertTrackerLatestRows };
