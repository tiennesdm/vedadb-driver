<?php
// QueryBuilderTest.php — Query builder tests for VedaDB PHP driver
use PHPUnit\Framework\TestCase;

class QueryBuilderTest extends TestCase
{
    public function testSelectAll(): void
    {
        $qb = (new QueryBuilder())->table('users');
        $result = $qb->build();
        $this->assertEquals('SELECT * FROM users', $result['sql']);
    }

    public function testSelectColumns(): void
    {
        $qb = (new QueryBuilder())->table('users')->select('id', 'name', 'email');
        $result = $qb->build();
        $this->assertEquals('SELECT id, name, email FROM users', $result['sql']);
    }

    public function testSingleWhere(): void
    {
        $qb = (new QueryBuilder())->table('users')->where('id = ?', 1);
        $result = $qb->build();
        $this->assertStringContainsString('WHERE id = ?', $result['sql']);
        $this->assertContains(1, $result['params']);
    }

    public function testMultipleWhereAnd(): void
    {
        $qb = (new QueryBuilder())->table('users')->where('age > ?', 18)->where('active = ?', true);
        $result = $qb->build();
        $this->assertStringContainsString('AND', $result['sql']);
        $this->assertCount(2, $result['params']);
    }

    public function testOrWhere(): void
    {
        $qb = (new QueryBuilder())->table('users')->where('role = ?', 'admin')->orWhere('role = ?', 'mod');
        $result = $qb->build();
        $this->assertStringContainsString('OR', $result['sql']);
    }

    public function testInnerJoin(): void
    {
        $qb = (new QueryBuilder())->table('users')->select('users.name', 'orders.total');
        $qb->join('orders', 'users.id = orders.user_id');
        $result = $qb->build();
        $this->assertStringContainsString('INNER JOIN orders', $result['sql']);
    }

    public function testLeftJoin(): void
    {
        $qb = (new QueryBuilder())->table('users')->leftJoin('profiles', 'users.id = profiles.user_id');
        $result = $qb->build();
        $this->assertStringContainsString('LEFT JOIN profiles', $result['sql']);
    }

    public function testOrderByAsc(): void
    {
        $qb = (new QueryBuilder())->table('users')->orderBy('name');
        $result = $qb->build();
        $this->assertStringContainsString('ORDER BY name ASC', $result['sql']);
    }

    public function testOrderByDesc(): void
    {
        $qb = (new QueryBuilder())->table('users')->orderByDesc('created_at');
        $result = $qb->build();
        $this->assertStringContainsString('ORDER BY created_at DESC', $result['sql']);
    }

    public function testLimit(): void
    {
        $qb = (new QueryBuilder())->table('users')->limit(10);
        $result = $qb->build();
        $this->assertStringContainsString('LIMIT ?', $result['sql']);
        $this->assertContains(10, $result['params']);
    }

    public function testOffset(): void
    {
        $qb = (new QueryBuilder())->table('users')->offset(20);
        $result = $qb->build();
        $this->assertStringContainsString('OFFSET ?', $result['sql']);
        $this->assertContains(20, $result['params']);
    }

    public function testComplexQuery(): void
    {
        $qb = (new QueryBuilder())->table('users');
        $qb->select('users.id', 'users.name', 'orders.total');
        $qb->join('orders', 'users.id = orders.user_id');
        $qb->where('users.active = ?', true);
        $qb->where('users.age >= ?', 18);
        $qb->orderByDesc('orders.created_at');
        $qb->limit(10);
        $result = $qb->build();

        $this->assertStringContainsString('SELECT', $result['sql']);
        $this->assertStringContainsString('FROM users', $result['sql']);
        $this->assertStringContainsString('INNER JOIN orders', $result['sql']);
        $this->assertStringContainsString('WHERE', $result['sql']);
        $this->assertStringContainsString('ORDER BY', $result['sql']);
        $this->assertStringContainsString('LIMIT ?', $result['sql']);
    }

    public function testGroupBy(): void
    {
        $qb = (new QueryBuilder())->table('orders')->select('status', 'COUNT(*) as count')->groupBy('status');
        $result = $qb->build();
        $this->assertStringContainsString('GROUP BY status', $result['sql']);
    }

    public function testChaining(): void
    {
        $qb = new QueryBuilder();
        $result = $qb->table('test')->select('id')->where('id = ?', 1);
        $this->assertSame($qb, $result);
    }
}

class QueryBuilder
{
    private string $table = '';
    private array $columns = [];
    private array $whereClauses = [];
    private array $joins = [];
    private array $orderBy = [];
    private array $groupBy = [];
    private ?int $limit = null;
    private ?int $offset = null;
    private array $params = [];

    public function table(string $name): self { $this->table = $name; return $this; }
    public function select(string ...$cols): self { $this->columns = $cols; return $this; }
    public function where(string $condition, ...$values): self { $this->whereClauses[] = ['op' => 'AND', 'condition' => $condition]; $this->params = array_merge($this->params, $values); return $this; }
    public function orWhere(string $condition, ...$values): self { $this->whereClauses[] = ['op' => 'OR', 'condition' => $condition]; $this->params = array_merge($this->params, $values); return $this; }
    public function join(string $table, string $on): self { $this->joins[] = ['type' => 'INNER', 'table' => $table, 'on' => $on]; return $this; }
    public function leftJoin(string $table, string $on): self { $this->joins[] = ['type' => 'LEFT', 'table' => $table, 'on' => $on]; return $this; }
    public function rightJoin(string $table, string $on): self { $this->joins[] = ['type' => 'RIGHT', 'table' => $table, 'on' => $on]; return $this; }
    public function orderBy(string $column): self { $this->orderBy[] = ['column' => $column, 'dir' => 'ASC']; return $this; }
    public function orderByDesc(string $column): self { $this->orderBy[] = ['column' => $column, 'dir' => 'DESC']; return $this; }
    public function groupBy(string ...$columns): self { $this->groupBy = array_merge($this->groupBy, $columns); return $this; }
    public function limit(int $n): self { $this->limit = $n; $this->params[] = $n; return $this; }
    public function offset(int $n): self { $this->offset = $n; $this->params[] = $n; return $this; }

    public function build(): array
    {
        $sql = $this->columns ? 'SELECT ' . implode(', ', $this->columns) : 'SELECT *';
        $sql .= " FROM {$this->table}";
        foreach ($this->joins as $j) { $sql .= " {$j['type']} JOIN {$j['table']} ON {$j['on']}"; }
        foreach ($this->whereClauses as $i => $w) { $sql .= $i === 0 ? " WHERE {$w['condition']}" : " {$w['op']} {$w['condition']}"; }
        if ($this->groupBy) $sql .= ' GROUP BY ' . implode(', ', $this->groupBy);
        if ($this->orderBy) { $parts = array_map(fn($o) => "{$o['column']} {$o['dir']}", $this->orderBy); $sql .= ' ORDER BY ' . implode(', ', $parts); }
        if ($this->limit !== null) $sql .= ' LIMIT ?';
        if ($this->offset !== null) $sql .= ' OFFSET ?';
        return ['sql' => $sql, 'params' => $this->params];
    }
}
