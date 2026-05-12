use crate::error::VedaError;
use crate::result::Value;

/// Fluent SQL query builder for VedaDB.
#[derive(Debug, Clone)]
pub struct QueryBuilder {
    operation: Operation,
    table: String,
    columns: Vec<String>,
    values: Vec<Vec<Value>>,
    sets: Vec<(String, Value)>,
    conditions: Vec<Condition>,
    order_by: Vec<OrderClause>,
    limit: Option<usize>,
    offset: Option<usize>,
    joins: Vec<JoinClause>,
    group_by: Vec<String>,
    having: Vec<Condition>,
    returning: Vec<String>,
    distinct: bool,
    for_update: bool,
    raw_sql: Option<String>,
}

#[derive(Debug, Clone)]
enum Operation {
    Select,
    Insert,
    Update,
    Delete,
    Count,
    Exists,
    Raw,
}

#[derive(Debug, Clone)]
struct Condition {
    column: String,
    op: String,
    value: Value,
    conjunction: String, // AND / OR
}

#[derive(Debug, Clone)]
struct OrderClause {
    column: String,
    direction: OrderDirection,
}

#[derive(Debug, Clone)]
enum OrderDirection {
    Asc,
    Desc,
}

#[derive(Debug, Clone)]
struct JoinClause {
    join_type: JoinType,
    table: String,
    on_condition: String,
}

#[derive(Debug, Clone)]
enum JoinType {
    Inner,
    Left,
    Right,
    Full,
}

impl QueryBuilder {
    /// Start a SELECT query.
    pub fn select(table: &str) -> Self {
        QueryBuilder {
            operation: Operation::Select,
            table: table.to_string(),
            columns: Vec::new(),
            values: Vec::new(),
            sets: Vec::new(),
            conditions: Vec::new(),
            order_by: Vec::new(),
            limit: None,
            offset: None,
            joins: Vec::new(),
            group_by: Vec::new(),
            having: Vec::new(),
            returning: Vec::new(),
            distinct: false,
            for_update: false,
            raw_sql: None,
        }
    }

    /// Start an INSERT query.
    pub fn insert(table: &str) -> Self {
        QueryBuilder {
            operation: Operation::Insert,
            table: table.to_string(),
            columns: Vec::new(),
            values: Vec::new(),
            sets: Vec::new(),
            conditions: Vec::new(),
            order_by: Vec::new(),
            limit: None,
            offset: None,
            joins: Vec::new(),
            group_by: Vec::new(),
            having: Vec::new(),
            returning: Vec::new(),
            distinct: false,
            for_update: false,
            raw_sql: None,
        }
    }

    /// Start an UPDATE query.
    pub fn update(table: &str) -> Self {
        QueryBuilder {
            operation: Operation::Update,
            table: table.to_string(),
            columns: Vec::new(),
            values: Vec::new(),
            sets: Vec::new(),
            conditions: Vec::new(),
            order_by: Vec::new(),
            limit: None,
            offset: None,
            joins: Vec::new(),
            group_by: Vec::new(),
            having: Vec::new(),
            returning: Vec::new(),
            distinct: false,
            for_update: false,
            raw_sql: None,
        }
    }

    /// Start a DELETE query.
    pub fn delete(table: &str) -> Self {
        QueryBuilder {
            operation: Operation::Delete,
            table: table.to_string(),
            columns: Vec::new(),
            values: Vec::new(),
            sets: Vec::new(),
            conditions: Vec::new(),
            order_by: Vec::new(),
            limit: None,
            offset: None,
            joins: Vec::new(),
            group_by: Vec::new(),
            having: Vec::new(),
            returning: Vec::new(),
            distinct: false,
            for_update: false,
            raw_sql: None,
        }
    }

    /// Start a COUNT query.
    pub fn count(table: &str) -> Self {
        QueryBuilder {
            operation: Operation::Count,
            table: table.to_string(),
            columns: Vec::new(),
            values: Vec::new(),
            sets: Vec::new(),
            conditions: Vec::new(),
            order_by: Vec::new(),
            limit: None,
            offset: None,
            joins: Vec::new(),
            group_by: Vec::new(),
            having: Vec::new(),
            returning: Vec::new(),
            distinct: false,
            for_update: false,
            raw_sql: None,
        }
    }

    /// Start from raw SQL.
    pub fn raw(sql: &str) -> Self {
        QueryBuilder {
            operation: Operation::Raw,
            table: String::new(),
            columns: Vec::new(),
            values: Vec::new(),
            sets: Vec::new(),
            conditions: Vec::new(),
            order_by: Vec::new(),
            limit: None,
            offset: None,
            joins: Vec::new(),
            group_by: Vec::new(),
            having: Vec::new(),
            returning: Vec::new(),
            distinct: false,
            for_update: false,
            raw_sql: Some(sql.to_string()),
        }
    }

    // --- Column Selection ---

    /// Select specific columns.
    pub fn columns(mut self, cols: &[&str]) -> Self {
        self.columns = cols.iter().map(|s| s.to_string()).collect();
        self
    }

    /// Select a single column.
    pub fn column(mut self, col: &str) -> Self {
        self.columns.push(col.to_string());
        self
    }

    /// Use DISTINCT.
    pub fn distinct(mut self) -> Self {
        self.distinct = true;
        self
    }

    // --- WHERE Clauses ---

    /// Add an AND WHERE condition.
    pub fn where_eq(mut self, column: &str, value: impl Into<Value>) -> Self {
        self.conditions.push(Condition {
            column: column.to_string(),
            op: "=".to_string(),
            value: value.into(),
            conjunction: "AND".to_string(),
        });
        self
    }

    pub fn where_ne(self, column: &str, value: impl Into<Value>) -> Self {
        self.where_op(column, "!=", value)
    }

    pub fn where_gt(self, column: &str, value: impl Into<Value>) -> Self {
        self.where_op(column, ">", value)
    }

    pub fn where_gte(self, column: &str, value: impl Into<Value>) -> Self {
        self.where_op(column, ">=", value)
    }

    pub fn where_lt(self, column: &str, value: impl Into<Value>) -> Self {
        self.where_op(column, "<", value)
    }

    pub fn where_lte(self, column: &str, value: impl Into<Value>) -> Self {
        self.where_op(column, "<=", value)
    }

    pub fn where_like(mut self, column: &str, pattern: &str) -> Self {
        self.conditions.push(Condition {
            column: column.to_string(),
            op: "LIKE".to_string(),
            value: Value::String(pattern.to_string()),
            conjunction: "AND".to_string(),
        });
        self
    }

    pub fn where_in(mut self, column: &str, values: Vec<impl Into<Value>>) -> Self {
        let vals: Vec<Value> = values.into_iter().map(|v| v.into()).collect();
        self.conditions.push(Condition {
            column: column.to_string(),
            op: "IN".to_string(),
            value: Value::Array(vals),
            conjunction: "AND".to_string(),
        });
        self
    }

    pub fn where_null(mut self, column: &str) -> Self {
        self.conditions.push(Condition {
            column: column.to_string(),
            op: "IS NULL".to_string(),
            value: Value::Null,
            conjunction: "AND".to_string(),
        });
        self
    }

    fn where_op(mut self, column: &str, op: &str, value: impl Into<Value>) -> Self {
        self.conditions.push(Condition {
            column: column.to_string(),
            op: op.to_string(),
            value: value.into(),
            conjunction: "AND".to_string(),
        });
        self
    }

    // --- JOIN Clauses ---

    pub fn inner_join(mut self, table: &str, on: &str) -> Self {
        self.joins.push(JoinClause {
            join_type: JoinType::Inner,
            table: table.to_string(),
            on_condition: on.to_string(),
        });
        self
    }

    pub fn left_join(mut self, table: &str, on: &str) -> Self {
        self.joins.push(JoinClause {
            join_type: JoinType::Left,
            table: table.to_string(),
            on_condition: on.to_string(),
        });
        self
    }

    pub fn right_join(mut self, table: &str, on: &str) -> Self {
        self.joins.push(JoinClause {
            join_type: JoinType::Right,
            table: table.to_string(),
            on_condition: on.to_string(),
        });
        self
    }

    // --- ORDER BY ---

    pub fn order_by(mut self, column: &str, desc: bool) -> Self {
        self.order_by.push(OrderClause {
            column: column.to_string(),
            direction: if desc {
                OrderDirection::Desc
            } else {
                OrderDirection::Asc
            },
        });
        self
    }

    pub fn order_by_asc(self, column: &str) -> Self {
        self.order_by(column, false)
    }

    pub fn order_by_desc(self, column: &str) -> Self {
        self.order_by(column, true)
    }

    // --- LIMIT / OFFSET ---

    pub fn limit(mut self, n: usize) -> Self {
        self.limit = Some(n);
        self
    }

    pub fn offset(mut self, n: usize) -> Self {
        self.offset = Some(n);
        self
    }

    // --- INSERT Values ---

    pub fn values(mut self, vals: Vec<Vec<impl Into<Value>>>) -> Self {
        self.values = vals
            .into_iter()
            .map(|row| row.into_iter().map(|v| v.into()).collect())
            .collect();
        self
    }

    pub fn value(mut self, row: Vec<impl Into<Value>>) -> Self {
        self.values.push(row.into_iter().map(|v| v.into()).collect());
        self
    }

    // --- UPDATE Sets ---

    pub fn set(mut self, column: &str, value: impl Into<Value>) -> Self {
        self.sets.push((column.to_string(), value.into()));
        self
    }

    // --- GROUP BY / HAVING ---

    pub fn group_by(mut self, columns: &[&str]) -> Self {
        self.group_by = columns.iter().map(|s| s.to_string()).collect();
        self
    }

    pub fn having(mut self, column: &str, op: &str, value: impl Into<Value>) -> Self {
        self.having.push(Condition {
            column: column.to_string(),
            op: op.to_string(),
            value: value.into(),
            conjunction: "AND".to_string(),
        });
        self
    }

    // --- RETURNING ---

    pub fn returning(mut self, columns: &[&str]) -> Self {
        self.returning = columns.iter().map(|s| s.to_string()).collect();
        self
    }

    /// FOR UPDATE clause.
    pub fn for_update(mut self) -> Self {
        self.for_update = true;
        self
    }

    // --- Build ---

    /// Build the SQL string.
    pub fn build(self) -> Result<String, VedaError> {
        if let Some(raw) = self.raw_sql {
            return Ok(raw);
        }

        let sql = match self.operation {
            Operation::Select => self.build_select(),
            Operation::Insert => self.build_insert(),
            Operation::Update => self.build_update(),
            Operation::Delete => self.build_delete(),
            Operation::Count => self.build_count(),
            Operation::Exists => self.build_exists(),
            Operation::Raw => unreachable!(),
        };

        Ok(sql)
    }

    fn build_select(&self) -> String {
        let mut sql = String::from("SELECT ");

        if self.distinct {
            sql.push_str("DISTINCT ");
        }

        if self.columns.is_empty() {
            sql.push('*');
        } else {
            sql.push_str(&self.columns.join(", "));
        }

        sql.push_str(&format!(" FROM {}", self.table));

        // JOINs
        for join in &self.joins {
            let join_type = match join.join_type {
                JoinType::Inner => "INNER JOIN",
                JoinType::Left => "LEFT JOIN",
                JoinType::Right => "RIGHT JOIN",
                JoinType::Full => "FULL JOIN",
            };
            sql.push_str(&format!(
                " {} {} ON {}",
                join_type, join.table, join.on_condition
            ));
        }

        // WHERE
        self.append_where(&mut sql);

        // GROUP BY
        if !self.group_by.is_empty() {
            sql.push_str(&format!(" GROUP BY {}", self.group_by.join(", ")));
        }

        // HAVING
        if !self.having.is_empty() {
            let clauses: Vec<String> = self
                .having
                .iter()
                .map(|c| format!("{} {} {}", c.column, c.op, c.value))
                .collect();
            sql.push_str(&format!(" HAVING {}", clauses.join(" AND ")));
        }

        // ORDER BY
        if !self.order_by.is_empty() {
            let orders: Vec<String> = self
                .order_by
                .iter()
                .map(|o| {
                    format!(
                        "{} {}",
                        o.column,
                        match o.direction {
                            OrderDirection::Asc => "ASC",
                            OrderDirection::Desc => "DESC",
                        }
                    )
                })
                .collect();
            sql.push_str(&format!(" ORDER BY {}", orders.join(", ")));
        }

        // LIMIT
        if let Some(limit) = self.limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }

        // OFFSET
        if let Some(offset) = self.offset {
            sql.push_str(&format!(" OFFSET {}", offset));
        }

        // FOR UPDATE
        if self.for_update {
            sql.push_str(" FOR UPDATE");
        }

        sql.push(';');
        sql
    }

    fn build_insert(&self) -> String {
        let mut sql = format!("INSERT INTO {}", self.table);

        if !self.columns.is_empty() {
            sql.push_str(&format!(" ({})", self.columns.join(", ")));
        }

        if !self.values.is_empty() {
            let value_sets: Vec<String> = self
                .values
                .iter()
                .map(|row| {
                    let vals: Vec<String> = row.iter().map(|v| v.to_string()).collect();
                    format!("({})", vals.join(", "))
                })
                .collect();
            sql.push_str(&format!(" VALUES {}", value_sets.join(", ")));
        }

        if !self.returning.is_empty() {
            sql.push_str(&format!(" RETURNING {}", self.returning.join(", ")));
        }

        sql.push(';');
        sql
    }

    fn build_update(&self) -> String {
        let mut sql = format!("UPDATE {} SET ", self.table);

        let sets: Vec<String> = self
            .sets
            .iter()
            .map(|(col, val)| format!("{} = {}", col, val))
            .collect();
        sql.push_str(&sets.join(", "));

        self.append_where(&mut sql);

        if !self.returning.is_empty() {
            sql.push_str(&format!(" RETURNING {}", self.returning.join(", ")));
        }

        sql.push(';');
        sql
    }

    fn build_delete(&self) -> String {
        let mut sql = format!("DELETE FROM {}", self.table);
        self.append_where(&mut sql);

        if !self.returning.is_empty() {
            sql.push_str(&format!(" RETURNING {}", self.returning.join(", ")));
        }

        sql.push(';');
        sql
    }

    fn build_count(&self) -> String {
        let mut sql = format!("SELECT COUNT(*) FROM {}", self.table);
        self.append_where(&mut sql);
        sql.push(';');
        sql
    }

    fn build_exists(&self) -> String {
        let mut sql = format!(
            "SELECT EXISTS(SELECT 1 FROM {})",
            self.table
        );
        self.append_where(&mut sql);
        sql.push(';');
        sql
    }

    fn append_where(&self, sql: &mut String) {
        if !self.conditions.is_empty() {
            let clauses: Vec<String> = self
                .conditions
                .iter()
                .map(|c| {
                    if c.op == "IS NULL" {
                        format!("{} IS NULL", c.column)
                    } else if c.op == "IN" {
                        if let Value::Array(vals) = &c.value {
                            let items: Vec<String> = vals.iter().map(|v| v.to_string()).collect();
                            format!("{} IN ({})", c.column, items.join(", "))
                        } else {
                            format!("{} IN ({})", c.column, c.value)
                        }
                    } else {
                        format!("{} {} {}", c.column, c.op, c.value)
                    }
                })
                .collect();
            sql.push_str(&format!(" WHERE {}", clauses.join(" AND ")));
        }
    }

    /// Build the SQL and the parameters separately for prepared statements.
    pub fn build_prepared(self) -> Result<(String, Vec<Value>), VedaError> {
        // For prepared statements, we'd replace values with ? placeholders
        // This is a simplified version - full implementation would track param positions
        let sql = self.build()?;
        let params: Vec<Value> = self
            .conditions
            .into_iter()
            .map(|c| c.value)
            .collect();
        Ok((sql, params))
    }
}

impl Default for QueryBuilder {
    fn default() -> Self {
        QueryBuilder::select("")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_select_basic() {
        let sql = QueryBuilder::select("users")
            .columns(&["id", "name", "email"])
            .build()
            .unwrap();
        assert_eq!(sql, "SELECT id, name, email FROM users;");
    }

    #[test]
    fn test_select_where() {
        let sql = QueryBuilder::select("users")
            .where_eq("age", 30i64)
            .where_gt("id", 100i64)
            .build()
            .unwrap();
        assert_eq!(
            sql,
            "SELECT * FROM users WHERE age = 30 AND id > 100;"
        );
    }

    #[test]
    fn test_select_join() {
        let sql = QueryBuilder::select("users")
            .columns(&["users.id", "users.name", "orders.total"])
            .inner_join("orders", "users.id = orders.user_id")
            .build()
            .unwrap();
        assert_eq!(
            sql,
            "SELECT users.id, users.name, orders.total FROM users INNER JOIN orders ON users.id = orders.user_id;"
        );
    }

    #[test]
    fn test_insert() {
        let sql = QueryBuilder::insert("users")
            .columns(&["name", "age", "email"])
            .value(vec!["Alice", 30i64, "alice@example.com"])
            .build()
            .unwrap();
        assert_eq!(
            sql,
            "INSERT INTO users (name, age, email) VALUES ('Alice', 30, 'alice@example.com');"
        );
    }

    #[test]
    fn test_update() {
        let sql = QueryBuilder::update("users")
            .set("name", "Bob")
            .set("age", 31i64)
            .where_eq("id", 1i64)
            .build()
            .unwrap();
        assert_eq!(
            sql,
            "UPDATE users SET name = 'Bob', age = 31 WHERE id = 1;"
        );
    }

    #[test]
    fn test_delete() {
        let sql = QueryBuilder::delete("users")
            .where_eq("status", "inactive")
            .build()
            .unwrap();
        assert_eq!(sql, "DELETE FROM users WHERE status = 'inactive';");
    }

    #[test]
    fn test_order_limit() {
        let sql = QueryBuilder::select("users")
            .order_by_desc("created_at")
            .limit(10)
            .offset(20)
            .build()
            .unwrap();
        assert_eq!(
            sql,
            "SELECT * FROM users ORDER BY created_at DESC LIMIT 10 OFFSET 20;"
        );
    }

    #[test]
    fn test_select_distinct() {
        let sql = QueryBuilder::select("users")
            .distinct()
            .column("country")
            .build()
            .unwrap();
        assert_eq!(sql, "SELECT DISTINCT country FROM users;");
    }

    #[test]
    fn test_where_in() {
        let sql = QueryBuilder::select("users")
            .where_in("status", vec!["active", "pending"])
            .build()
            .unwrap();
        assert_eq!(
            sql,
            "SELECT * FROM users WHERE status IN ('active', 'pending');"
        );
    }

    #[test]
    fn test_count() {
        let sql = QueryBuilder::count("users")
            .where_eq("active", true)
            .build()
            .unwrap();
        assert_eq!(sql, "SELECT COUNT(*) FROM users WHERE active = true;");
    }

    #[test]
    fn test_raw_sql() {
        let sql = QueryBuilder::raw("SELECT * FROM users WHERE id = 1").build().unwrap();
        assert_eq!(sql, "SELECT * FROM users WHERE id = 1");
    }
}
