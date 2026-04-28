/**
 * VedaDB ORM Session (Transaction)
 */

import { DriverClient, DriverResult } from './types';
import { SessionError } from './errors';

export class Session {
  private client: DriverClient;
  private _committed: boolean = false;
  private _rolledBack: boolean = false;
  private _active: boolean = true;

  private constructor(client: DriverClient) {
    this.client = client;
  }

  get active(): boolean {
    return this._active;
  }

  /**
   * Create a new Session by acquiring a client and beginning a transaction.
   */
  static async create(acquireFn: () => Promise<DriverClient>): Promise<Session> {
    const client = await acquireFn();
    try {
      await client.query('BEGIN;');
    } catch (err: any) {
      throw new SessionError(`Failed to begin transaction: ${err.message}`);
    }
    return new Session(client);
  }

  /**
   * Execute a query within this session.
   */
  async query(sql: string): Promise<DriverResult> {
    if (!this._active) {
      throw new SessionError('Session is no longer active (already committed or rolled back)');
    }
    return this.client.query(sql);
  }

  /**
   * Execute a non-returning statement within this session.
   */
  async exec(sql: string): Promise<string> {
    if (!this._active) {
      throw new SessionError('Session is no longer active');
    }
    return this.client.exec(sql);
  }

  /**
   * Commit the transaction.
   */
  async commit(): Promise<void> {
    if (!this._active) {
      throw new SessionError('Session is no longer active');
    }
    try {
      await this.client.query('COMMIT;');
      this._committed = true;
    } finally {
      this._active = false;
    }
  }

  /**
   * Rollback the transaction.
   */
  async rollback(): Promise<void> {
    if (!this._active) return; // safe to call multiple times
    try {
      await this.client.query('ROLLBACK;');
      this._rolledBack = true;
    } finally {
      this._active = false;
    }
  }

  /**
   * Run a function inside a transaction with auto-commit / auto-rollback.
   */
  static async transaction<R>(
    acquireFn: () => Promise<DriverClient>,
    fn: (session: Session) => Promise<R>
  ): Promise<R> {
    const session = await Session.create(acquireFn);
    try {
      const result = await fn(session);
      await session.commit();
      return result;
    } catch (err) {
      await session.rollback().catch(() => {});
      throw err;
    }
  }
}
