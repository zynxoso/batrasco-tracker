/**
 * Alias for Sinotrack ingest. POST /api/tracker accepts the same body as POST /api/ingest.
 * Bridge can use either URL (e.g. INGEST_URL=https://.../api/tracker).
 */

export { OPTIONS, POST } from './ingest';
