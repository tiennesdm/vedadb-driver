/**
 * Real VedaDB Workbench REST API Client
 * Connects to VedaDB via HTTP REST API (port 9090)
 * NO localStorage data operations — pure HTTP calls
 */

const API_KEY_STORAGE = 'vedadb_api_key';
const API_URL_STORAGE = 'vedadb_api_url';

export function getApiBase(): string {
  try {
    const saved = localStorage.getItem(API_URL_STORAGE);
    if (saved) return saved;
  } catch { /* */ }
  return 'http://localhost:9090';
}

export function setApiBase(url: string) {
  try { localStorage.setItem(API_URL_STORAGE, url); } catch { /* */ }
}

export function getApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) || '';
  } catch { return ''; }
}

export function setApiKey(key: string) {
  try { localStorage.setItem(API_KEY_STORAGE, key); } catch { /* */ }
}

export interface QueryResult {
  columns: string[];
  rows: string[][];
  rowCount: number;
  message: string;
}

export interface VedaDBStatus {
  connected: boolean;
  host: string;
  port: number;
  latency: number;
  error?: string;
}

let _status: VedaDBStatus = { connected: false, host: 'localhost', port: 9090, latency: 0 };

export function getConnectionStatus(): VedaDBStatus {
  return { ..._status };
}

function getHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };
  const key = getApiKey();
  if (key) h['X-API-Key'] = key;
  return h;
}

/** Execute a SQL query */
export async function vedaQuery(sql: string, database?: string): Promise<QueryResult> {
  const base = getApiBase();
  const start = performance.now();
  try {
    const res = await fetch(`${base}/api/query`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ query: sql, ...(database ? { database } : {}) }),
    });
    const latency = Math.round(performance.now() - start);
    _status.latency = latency;

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      _status.connected = false;
      _status.error = err.error || `HTTP ${res.status}`;
      throw new Error(_status.error);
    }

    const data = await res.json();
    _status.connected = true;
    _status.error = undefined;
    return {
      columns: data.columns || [],
      rows: data.rows || [],
      rowCount: data.rowCount || 0,
      message: data.message || '',
    };
  } catch (err: any) {
    _status.connected = false;
    _status.error = err.message;
    throw err;
  }
}

/** Test connection to VedaDB */
export async function vedaTestConnection(): Promise<boolean> {
  const base = getApiBase();
  try {
    const res = await fetch(`${base}/health`, {
      method: 'GET',
      headers: getHeaders(),
    });
    if (res.ok) {
      _status.connected = true;
      _status.error = undefined;
      return true;
    }
    _status.connected = false;
    return false;
  } catch {
    _status.connected = false;
    return false;
  }
}

/** Insert a row */
export async function vedaInsert(table: string, values: Record<string, string>): Promise<{ message: string }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/data/insert`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ table, values }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Update a row */
export async function vedaUpdate(table: string, column: string, value: string, where: string): Promise<{ message: string; affected: number }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/data/update`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ table, column, value, where }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Delete a row */
export async function vedaDelete(table: string, where: string): Promise<{ message: string; affected: number }> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/data/delete`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ table, where }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Execute mutation (INSERT/UPDATE/DELETE as SQL) */
export async function vedaExec(sql: string): Promise<{ message: string; rowCount: number }> {
  const result = await vedaQuery(sql);
  return { message: result.message, rowCount: result.rowCount };
}

/** Select rows */
export async function vedaSelect(table: string, options: {
  columns?: string[];
  where?: string;
  orderBy?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<QueryResult> {
  let sql = `SELECT ${options.columns?.join(', ') || '*'} FROM ${table}`;
  if (options.where) sql += ` WHERE ${options.where}`;
  if (options.orderBy) sql += ` ORDER BY ${options.orderBy}`;
  if (options.limit) sql += ` LIMIT ${options.limit}`;
  if (options.offset) sql += ` OFFSET ${options.offset}`;
  return vedaQuery(sql);
}

/** List tables */
export async function vedaListTables(): Promise<string[]> {
  const base = getApiBase();
  try {
    const res = await fetch(`${base}/api/tables`, {
      method: 'GET',
      headers: getHeaders(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.tables || [];
  } catch {
    return [];
  }
}

/** Get table schema */
export async function vedaSchema(table: string): Promise<any> {
  const base = getApiBase();
  try {
    const res = await fetch(`${base}/api/schema?table=${encodeURIComponent(table)}`, {
      method: 'GET',
      headers: getHeaders(),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/** Convert QueryResult rows to objects */
export function toObjects(result: QueryResult): Record<string, string>[] {
  return result.rows.map((row) => {
    const obj: Record<string, string> = {};
    result.columns.forEach((col, i) => {
      obj[col] = row[i] ?? '';
    });
    return obj;
  });
}

/** Get first row as object */
export function firstRow(result: QueryResult): Record<string, string> | null {
  if (result.rows.length === 0) return null;
  return toObjects(result)[0];
}
