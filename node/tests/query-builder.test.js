/**
 * query-builder.test.js — Query builder tests for VedaDB Node.js driver
 */

class QueryBuilder {
  constructor() {
    this.tableName = '';
    this.columns = [];
    this.whereClauses = [];
    this.joins = [];
    this.orderByClauses = [];
    this.groupByColumns = [];
    this.limitValue = null;
    this.offsetValue = null;
    this.params = [];
  }

  table(name) {
    this.tableName = name;
    return this;
  }

  select(...columns) {
    this.columns = columns;
    return this;
  }

  where(condition, ...values) {
    this.whereClauses.push({ operator: 'AND', condition });
    this.params.push(...values);
    return this;
  }

  orWhere(condition, ...values) {
    this.whereClauses.push({ operator: 'OR', condition });
    this.params.push(...values);
    return this;
  }

  join(table, on) {
    this.joins.push({ type: 'INNER', table, on });
    return this;
  }

  leftJoin(table, on) {
    this.joins.push({ type: 'LEFT', table, on });
    return this;
  }

  rightJoin(table, on) {
    this.joins.push({ type: 'RIGHT', table, on });
    return this;
  }

  orderBy(column, direction = 'ASC') {
    this.orderByClauses.push({ column, direction });
    return this;
  }

  orderByDesc(column) {
    return this.orderBy(column, 'DESC');
  }

  groupBy(...columns) {
    this.groupByColumns.push(...columns);
    return this;
  }

  limit(n) {
    this.limitValue = n;
    this.params.push(n);
    return this;
  }

  offset(n) {
    this.offsetValue = n;
    this.params.push(n);
    return this;
  }

  build() {
    let sql = '';

    // SELECT
    if (this.columns.length > 0) {
      sql += `SELECT ${this.columns.join(', ')}`;
    } else {
      sql += 'SELECT *';
    }

    // FROM
    sql += ` FROM ${this.tableName}`;

    // JOINS
    for (const j of this.joins) {
      sql += ` ${j.type} JOIN ${j.table} ON ${j.on}`;
    }

    // WHERE
    for (let i = 0; i < this.whereClauses.length; i++) {
      const w = this.whereClauses[i];
      if (i === 0) {
        sql += ` WHERE ${w.condition}`;
      } else {
        sql += ` ${w.operator} ${w.condition}`;
      }
    }

    // GROUP BY
    if (this.groupByColumns.length > 0) {
      sql += ` GROUP BY ${this.groupByColumns.join(', ')}`;
    }

    // ORDER BY
    if (this.orderByClauses.length > 0) {
      const parts = this.orderByClauses.map(o => `${o.column} ${o.direction}`);
      sql += ` ORDER BY ${parts.join(', ')}`;
    }

    // LIMIT
    if (this.limitValue !== null) {
      sql += ' LIMIT ?';
    }

    // OFFSET
    if (this.offsetValue !== null) {
      sql += ' OFFSET ?';
    }

    return { sql, params: [...this.params] };
  }
}

describe('QueryBuilder', () => {
  describe('SELECT', () => {
    test('should build SELECT *', () => {
      const qb = new QueryBuilder().table('users');
      const { sql } = qb.build();
      expect(sql).toBe('SELECT * FROM users');
    });

    test('should build SELECT with columns', () => {
      const qb = new QueryBuilder().table('users').select('id', 'name', 'email');
      const { sql } = qb.build();
      expect(sql).toBe('SELECT id, name, email FROM users');
    });
  });

  describe('WHERE', () => {
    test('should build single WHERE', () => {
      const qb = new QueryBuilder().table('users').where('id = ?', 1);
      const { sql, params } = qb.build();
      expect(sql).toContain('WHERE id = ?');
      expect(params).toContain(1);
    });

    test('should build multiple WHERE with AND', () => {
      const qb = new QueryBuilder().table('users').where('age > ?', 18).where('active = ?', true);
      const { sql, params } = qb.build();
      expect(sql).toContain('AND');
      expect(params).toEqual([18, true]);
    });

    test('should build OR WHERE', () => {
      const qb = new QueryBuilder().table('users').where('role = ?', 'admin').orWhere('role = ?', 'moderator');
      const { sql } = qb.build();
      expect(sql).toContain('OR');
    });
  });

  describe('JOIN', () => {
    test('should build INNER JOIN', () => {
      const qb = new QueryBuilder().table('users').select('users.name', 'orders.total');
      qb.join('orders', 'users.id = orders.user_id');
      const { sql } = qb.build();
      expect(sql).toContain('INNER JOIN orders');
      expect(sql).toContain('ON users.id = orders.user_id');
    });

    test('should build LEFT JOIN', () => {
      const qb = new QueryBuilder().table('users').leftJoin('profiles', 'users.id = profiles.user_id');
      const { sql } = qb.build();
      expect(sql).toContain('LEFT JOIN profiles');
    });

    test('should build RIGHT JOIN', () => {
      const qb = new QueryBuilder().table('orders').rightJoin('users', 'orders.user_id = users.id');
      const { sql } = qb.build();
      expect(sql).toContain('RIGHT JOIN users');
    });

    test('should build multiple JOINs', () => {
      const qb = new QueryBuilder().table('users');
      qb.join('orders', 'users.id = orders.user_id');
      qb.join('products', 'orders.product_id = products.id');
      const { sql } = qb.build();
      expect((sql.match(/JOIN/g) || []).length).toBe(2);
    });
  });

  describe('ORDER BY', () => {
    test('should build ORDER BY ASC', () => {
      const qb = new QueryBuilder().table('users').orderBy('name');
      const { sql } = qb.build();
      expect(sql).toContain('ORDER BY name ASC');
    });

    test('should build ORDER BY DESC', () => {
      const qb = new QueryBuilder().table('users').orderByDesc('created_at');
      const { sql } = qb.build();
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    test('should build multiple ORDER BY', () => {
      const qb = new QueryBuilder().table('users').orderBy('status').orderByDesc('created_at');
      const { sql } = qb.build();
      expect(sql).toContain('status ASC');
      expect(sql).toContain('created_at DESC');
    });
  });

  describe('Pagination', () => {
    test('should build LIMIT', () => {
      const qb = new QueryBuilder().table('users').limit(10);
      const { sql, params } = qb.build();
      expect(sql).toContain('LIMIT ?');
      expect(params).toContain(10);
    });

    test('should build OFFSET', () => {
      const qb = new QueryBuilder().table('users').offset(20);
      const { sql, params } = qb.build();
      expect(sql).toContain('OFFSET ?');
      expect(params).toContain(20);
    });

    test('should build LIMIT and OFFSET together', () => {
      const qb = new QueryBuilder().table('users').limit(10).offset(20);
      const { sql, params } = qb.build();
      expect(sql).toContain('LIMIT ?');
      expect(sql).toContain('OFFSET ?');
      expect(params).toEqual([10, 20]);
    });
  });

  describe('Complex Queries', () => {
    test('should build complete complex query', () => {
      const qb = new QueryBuilder().table('users');
      qb.select('users.id', 'users.name', 'orders.total');
      qb.join('orders', 'users.id = orders.user_id');
      qb.where('users.active = ?', true);
      qb.where('users.age >= ?', 18);
      qb.orderByDesc('orders.created_at');
      qb.limit(10);
      const { sql, params } = qb.build();

      expect(sql).toContain('SELECT');
      expect(sql).toContain('FROM users');
      expect(sql).toContain('INNER JOIN orders');
      expect(sql).toContain('WHERE');
      expect(sql).toContain('ORDER BY');
      expect(sql).toContain('LIMIT ?');
    });

    test('should build GROUP BY query', () => {
      const qb = new QueryBuilder().table('orders');
      qb.select('status', 'COUNT(*) as count');
      qb.groupBy('status');
      const { sql } = qb.build();
      expect(sql).toContain('GROUP BY status');
    });

    test('should support chaining', () => {
      const qb = new QueryBuilder();
      const result = qb.table('test').select('id').where('id = ?', 1);
      expect(result).toBe(qb);
    });
  });
});

module.exports = { QueryBuilder };
