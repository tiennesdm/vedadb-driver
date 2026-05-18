/**
 * VedaDB Adapter — DEPRECATED
 *
 * This module is kept for backward compatibility.
 * The application now uses vedadb-api.ts for HTTP REST API communication.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vedadb = (window as any).__vedadb;

/** @deprecated Use vedadb-api.ts instead */
export function createAdapter(): any {
  return vedadb || {};
}
