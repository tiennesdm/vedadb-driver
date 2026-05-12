/**
 * VedaDB ORM GraphProxy
 *
 * Provides graph traversal capabilities via VedaDB GRAPH commands.
 */

import { DriverResult } from './types';
import { SchemaDefinition } from './schema';
import { escapeIdentifier, escapeValue } from './utils';

export interface GraphTraversalOptions {
  direction?: 'OUT' | 'IN' | 'BOTH';
  edgeType?: string;
  maxDepth?: number;
  limit?: number;
}

export class GraphProxy<T = any> {
  private schema: SchemaDefinition<T>;
  private executor: (sql: string) => Promise<DriverResult>;
  private hydrator: (result: DriverResult) => T[];

  constructor(
    schema: SchemaDefinition<T>,
    executor: (sql: string) => Promise<DriverResult>,
    hydrator: (result: DriverResult) => T[]
  ) {
    this.schema = schema;
    this.executor = executor;
    this.hydrator = hydrator;
  }

  /**
   * Add an edge between two nodes.
   */
  async addEdge(fromId: any, toId: any, edgeType: string, properties?: Record<string, any>): Promise<void> {
    let sql = `GRAPH ADD EDGE '${edgeType}' FROM ${escapeValue(fromId)} TO ${escapeValue(toId)}`;
    if (properties && Object.keys(properties).length > 0) {
      const props = Object.entries(properties)
        .map(([k, v]) => `${escapeIdentifier(k)} = ${escapeValue(v)}`)
        .join(', ');
      sql += ` SET ${props}`;
    }
    sql += ';';
    await this.executor(sql);
  }

  /**
   * Remove an edge between two nodes.
   */
  async removeEdge(fromId: any, toId: any, edgeType: string): Promise<void> {
    await this.executor(
      `GRAPH REMOVE EDGE '${edgeType}' FROM ${escapeValue(fromId)} TO ${escapeValue(toId)};`
    );
  }

  /**
   * Traverse the graph from a starting node.
   */
  async traverse(startId: any, options: GraphTraversalOptions = {}): Promise<T[]> {
    const table = escapeIdentifier(this.schema.tableName);
    const direction = options.direction || 'OUT';
    const maxDepth = options.maxDepth || 3;
    const limit = options.limit || 100;

    let sql = `GRAPH TRAVERSE ${table} FROM ${escapeValue(startId)} DIRECTION ${direction} DEPTH ${maxDepth}`;
    if (options.edgeType) sql += ` EDGE '${options.edgeType}'`;
    sql += ` LIMIT ${limit};`;

    const result = await this.executor(sql);
    return this.hydrator(result);
  }

  /**
   * Find shortest path between two nodes.
   */
  async shortestPath(fromId: any, toId: any, edgeType?: string): Promise<T[]> {
    const table = escapeIdentifier(this.schema.tableName);
    let sql = `GRAPH SHORTEST_PATH ${table} FROM ${escapeValue(fromId)} TO ${escapeValue(toId)}`;
    if (edgeType) sql += ` EDGE '${edgeType}'`;
    sql += ';';

    const result = await this.executor(sql);
    return this.hydrator(result);
  }

  /**
   * Get neighbors of a node.
   */
  async neighbors(id: any, options: GraphTraversalOptions = {}): Promise<T[]> {
    return this.traverse(id, { ...options, maxDepth: 1 });
  }
}
