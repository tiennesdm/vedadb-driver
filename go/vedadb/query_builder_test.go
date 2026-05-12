// query_builder_test.go — Query builder tests for VedaDB Go driver
package vedadb

import (
	"strings"
	"testing"
)

// QueryBuilder constructs SQL queries programmatically
type QueryBuilder struct {
	table      string
	columns    []string
	whereClauses []whereClause
	joins      []joinClause
	orderBy    []orderClause
	limitVal   *int
	offsetVal  *int
	groupBy    []string
	havingClauses []string
}

type whereClause struct {
	condition string
	params    []interface{}
	logicalOp string
}

type joinClause struct {
	joinType string
	table    string
	on       string
}

type orderClause struct {
	column string
	desc   bool
}

func NewQueryBuilder() *QueryBuilder {
	return &QueryBuilder{}
}

func (qb *QueryBuilder) Table(name string) *QueryBuilder {
	qb.table = name
	return qb
}

func (qb *QueryBuilder) Select(columns ...string) *QueryBuilder {
	qb.columns = columns
	return qb
}

func (qb *QueryBuilder) Where(condition string, params ...interface{}) *QueryBuilder {
	qb.whereClauses = append(qb.whereClauses, whereClause{
		condition: condition,
		params:    params,
		logicalOp: "AND",
	})
	return qb
}

func (qb *QueryBuilder) OrWhere(condition string, params ...interface{}) *QueryBuilder {
	qb.whereClauses = append(qb.whereClauses, whereClause{
		condition: condition,
		params:    params,
		logicalOp: "OR",
	})
	return qb
}

func (qb *QueryBuilder) Join(table, on string) *QueryBuilder {
	qb.joins = append(qb.joins, joinClause{joinType: "INNER", table: table, on: on})
	return qb
}

func (qb *QueryBuilder) LeftJoin(table, on string) *QueryBuilder {
	qb.joins = append(qb.joins, joinClause{joinType: "LEFT", table: table, on: on})
	return qb
}

func (qb *QueryBuilder) RightJoin(table, on string) *QueryBuilder {
	qb.joins = append(qb.joins, joinClause{joinType: "RIGHT", table: table, on: on})
	return qb
}

func (qb *QueryBuilder) OrderBy(column string) *QueryBuilder {
	qb.orderBy = append(qb.orderBy, orderClause{column: column, desc: false})
	return qb
}

func (qb *QueryBuilder) OrderByDesc(column string) *QueryBuilder {
	qb.orderBy = append(qb.orderBy, orderClause{column: column, desc: true})
	return qb
}

func (qb *QueryBuilder) Limit(n int) *QueryBuilder {
	qb.limitVal = &n
	return qb
}

func (qb *QueryBuilder) Offset(n int) *QueryBuilder {
	qb.offsetVal = &n
	return qb
}

func (qb *QueryBuilder) GroupBy(columns ...string) *QueryBuilder {
	qb.groupBy = append(qb.groupBy, columns...)
	return qb
}

func (qb *QueryBuilder) Build() (string, []interface{}) {
	var sql strings.Builder
	var params []interface{}

	// SELECT
	if len(qb.columns) > 0 {
		sql.WriteString("SELECT ")
		sql.WriteString(strings.Join(qb.columns, ", "))
	} else {
		sql.WriteString("SELECT *")
	}

	// FROM
	sql.WriteString(" FROM ")
	sql.WriteString(qb.table)

	// JOINS
	for _, j := range qb.joins {
		sql.WriteString(" ")
		sql.WriteString(j.joinType)
		sql.WriteString(" JOIN ")
		sql.WriteString(j.table)
		sql.WriteString(" ON ")
		sql.WriteString(j.on)
	}

	// WHERE
	for i, w := range qb.whereClauses {
		if i == 0 {
			sql.WriteString(" WHERE ")
		} else {
			sql.WriteString(" ")
			sql.WriteString(w.logicalOp)
			sql.WriteString(" ")
		}
		sql.WriteString(w.condition)
		params = append(params, w.params...)
	}

	// GROUP BY
	if len(qb.groupBy) > 0 {
		sql.WriteString(" GROUP BY ")
		sql.WriteString(strings.Join(qb.groupBy, ", "))
	}

	// ORDER BY
	if len(qb.orderBy) > 0 {
		sql.WriteString(" ORDER BY ")
		parts := make([]string, len(qb.orderBy))
		for i, o := range qb.orderBy {
			if o.desc {
				parts[i] = o.column + " DESC"
			} else {
				parts[i] = o.column + " ASC"
			}
		}
		sql.WriteString(strings.Join(parts, ", "))
	}

	// LIMIT
	if qb.limitVal != nil {
		sql.WriteString(" LIMIT ?")
		params = append(params, *qb.limitVal)
	}

	// OFFSET
	if qb.offsetVal != nil {
		sql.WriteString(" OFFSET ?")
		params = append(params, *qb.offsetVal)
	}

	return sql.String(), params
}

func TestQueryBuilderSelect(t *testing.T) {
	t.Run("select_all", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, params := qb.Table("users").Build()

		expected := "SELECT * FROM users"
		if sql != expected {
			t.Errorf("expected %q, got %q", expected, sql)
		}
		if len(params) != 0 {
			t.Errorf("expected 0 params, got %d", len(params))
		}
	})

	t.Run("select_columns", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, _ := qb.Table("users").Select("id", "name", "email").Build()

		expected := "SELECT id, name, email FROM users"
		if sql != expected {
			t.Errorf("expected %q, got %q", expected, sql)
		}
	})

	t.Run("select_distinct_not_implemented", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, _ := qb.Table("users").Select("DISTINCT name").Build()

		if !strings.Contains(sql, "DISTINCT name") {
			t.Errorf("expected DISTINCT in SQL, got %q", sql)
		}
	})
}

func TestQueryBuilderWhere(t *testing.T) {
	t.Run("single_where", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, params := qb.Table("users").
			Where("id = ?", 1).
			Build()

		if !strings.Contains(sql, "WHERE id = ?") {
			t.Errorf("expected WHERE clause, got %q", sql)
		}
		if len(params) != 1 || params[0] != 1 {
			t.Errorf("expected params [1], got %v", params)
		}
	})

	t.Run("multiple_where_and", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, params := qb.Table("users").
			Where("age > ?", 18).
			Where("active = ?", true).
			Build()

		if !strings.Contains(sql, "AND") {
			t.Errorf("expected AND operator, got %q", sql)
		}
		if len(params) != 2 {
			t.Errorf("expected 2 params, got %d", len(params))
		}
	})

	t.Run("where_with_or", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, _ := qb.Table("users").
			Where("role = ?", "admin").
			OrWhere("role = ?", "moderator").
			Build()

		if !strings.Contains(sql, "OR") {
			t.Errorf("expected OR operator, got %q", sql)
		}
	})

	t.Run("where_with_in", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, _ := qb.Table("users").
			Where("status IN (?, ?, ?)", "active", "pending", "approved").
			Build()

		if !strings.Contains(sql, "IN") {
			t.Errorf("expected IN clause, got %q", sql)
		}
	})

	t.Run("where_null", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, _ := qb.Table("users").
			Where("deleted_at IS NULL").
			Build()

		if !strings.Contains(sql, "IS NULL") {
			t.Errorf("expected IS NULL, got %q", sql)
		}
	})
}

func TestQueryBuilderJoin(t *testing.T) {
	t.Run("inner_join", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, _ := qb.Table("users").
			Select("users.name", "orders.total").
			Join("orders", "users.id = orders.user_id").
			Build()

		if !strings.Contains(sql, "INNER JOIN orders") {
			t.Errorf("expected INNER JOIN, got %q", sql)
		}
		if !strings.Contains(sql, "ON users.id = orders.user_id") {
			t.Errorf("expected ON clause, got %q", sql)
		}
	})

	t.Run("left_join", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, _ := qb.Table("users").
			LeftJoin("profiles", "users.id = profiles.user_id").
			Build()

		if !strings.Contains(sql, "LEFT JOIN") {
			t.Errorf("expected LEFT JOIN, got %q", sql)
		}
	})

	t.Run("right_join", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, _ := qb.Table("orders").
			RightJoin("users", "orders.user_id = users.id").
			Build()

		if !strings.Contains(sql, "RIGHT JOIN") {
			t.Errorf("expected RIGHT JOIN, got %q", sql)
		}
	})

	t.Run("multiple_joins", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, _ := qb.Table("users").
			Join("orders", "users.id = orders.user_id").
			Join("products", "orders.product_id = products.id").
			Build()

		joinCount := strings.Count(sql, "JOIN")
		if joinCount != 2 {
			t.Errorf("expected 2 JOINs, got %d in %q", joinCount, sql)
		}
	})
}

func TestQueryBuilderSQL(t *testing.T) {
	t.Run("complete_query", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, params := qb.Table("users").
			Select("id", "name", "email").
			Where("active = ?", true).
			Where("age >= ?", 18).
			OrderByDesc("created_at").
			Limit(10).
			Offset(20).
			Build()

		expected := "SELECT id, name, email FROM users WHERE active = ? AND age >= ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
		if sql != expected {
			t.Errorf("expected %q, got %q", expected, sql)
		}
		if len(params) != 4 {
			t.Errorf("expected 4 params, got %d: %v", len(params), params)
		}
	})

	t.Run("group_by", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, _ := qb.Table("orders").
			Select("status", "COUNT(*) as count").
			GroupBy("status").
			Build()

		if !strings.Contains(sql, "GROUP BY status") {
			t.Errorf("expected GROUP BY, got %q", sql)
		}
	})

	t.Run("order_by_asc", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, _ := qb.Table("users").
			OrderBy("name").
			Build()

		if !strings.Contains(sql, "ORDER BY name ASC") {
			t.Errorf("expected ASC ordering, got %q", sql)
		}
	})

	t.Run("limit_only", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, params := qb.Table("users").Limit(5).Build()

		if !strings.Contains(sql, "LIMIT ?") {
			t.Errorf("expected LIMIT, got %q", sql)
		}
		if len(params) != 1 || params[0] != 5 {
			t.Errorf("expected limit param 5, got %v", params)
		}
	})

	t.Run("offset_without_limit", func(t *testing.T) {
		qb := NewQueryBuilder()
		sql, params := qb.Table("users").Offset(10).Build()

		if !strings.Contains(sql, "OFFSET ?") {
			t.Errorf("expected OFFSET, got %q", sql)
		}
		if len(params) != 1 || params[0] != 10 {
			t.Errorf("expected offset param 10, got %v", params)
		}
	})

	t.Run("chaining", func(t *testing.T) {
		qb := NewQueryBuilder()
		// Verify chaining returns *QueryBuilder
		result := qb.Table("test").Select("id").Where("id = ?", 1)
		if result != qb {
			t.Error("expected chaining to return same builder")
		}
	})
}
