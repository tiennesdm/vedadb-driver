package vedadb

import (
	"context"
	"fmt"
	"strings"
	"sync"
)

// ---------------------------------------------------------------------------
// Fluent Query Builder
// ---------------------------------------------------------------------------

// QueryBuilder provides a fluent API for constructing VedaQL queries.
type QueryBuilder struct {
	op         string
	table      string
	columns    []string
	wheres     []condition
	sets       []setClause
	values     [][]interface{}
	orderBy    []order
	groupBy    []string
	limitVal   int
	offsetVal  int
	having     string
	joins      []joinClause
	returning  []string
	unionSQL   string
	params     []interface{}
	mu         sync.Mutex
}

type condition struct {
	column   string
	operator string
	value    interface{}
	logic    string // AND or OR
}

type setClause struct {
	column string
	value  interface{}
}

type order struct {
	column string
	desc   bool
}

type joinClause struct {
	joinType string
	table    string
	on       string
}

// NewQuery creates a new QueryBuilder.
func NewQuery() *QueryBuilder {
	return &QueryBuilder{}
}

// Select starts a SELECT query.
func Select(columns ...string) *QueryBuilder {
	return &QueryBuilder{op: "SELECT", columns: columns}
}

// Insert starts an INSERT query.
func Insert(table string) *QueryBuilder {
	return &QueryBuilder{op: "INSERT", table: table}
}

// Update starts an UPDATE query.
func Update(table string) *QueryBuilder {
	return &QueryBuilder{op: "UPDATE", table: table}
}

// Delete starts a DELETE query.
func Delete(table string) *QueryBuilder {
	return &QueryBuilder{op: "DELETE", table: table}
}

// From sets the table for SELECT queries.
func (qb *QueryBuilder) From(table string) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	qb.table = table
	return qb
}

// Into sets the table for INSERT queries.
func (qb *QueryBuilder) Into(table string) *QueryBuilder {
	return qb.From(table)
}

// Set adds a SET clause for UPDATE queries.
func (qb *QueryBuilder) Set(column string, value interface{}) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	qb.sets = append(qb.sets, setClause{column: column, value: value})
	qb.params = append(qb.params, value)
	return qb
}

// Columns sets the columns for INSERT queries.
func (qb *QueryBuilder) Columns(cols ...string) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	qb.columns = cols
	return qb
}

// Values adds a row of values for INSERT queries.
func (qb *QueryBuilder) Values(vals ...interface{}) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	qb.values = append(qb.values, vals)
	qb.params = append(qb.params, vals...)
	return qb
}

// Where adds a WHERE condition with AND logic.
func (qb *QueryBuilder) Where(column, operator string, value interface{}) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	logic := "AND"
	if len(qb.wheres) == 0 {
		logic = ""
	}
	qb.wheres = append(qb.wheres, condition{column: column, operator: operator, value: value, logic: logic})
	qb.params = append(qb.params, value)
	return qb
}

// WhereOr adds a WHERE condition with OR logic.
func (qb *QueryBuilder) WhereOr(column, operator string, value interface{}) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	qb.wheres = append(qb.wheres, condition{column: column, operator: operator, value: value, logic: "OR"})
	qb.params = append(qb.params, value)
	return qb
}

// WhereIn adds a WHERE IN condition.
func (qb *QueryBuilder) WhereIn(column string, values ...interface{}) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	logic := "AND"
	if len(qb.wheres) == 0 {
		logic = ""
	}
	qb.wheres = append(qb.wheres, condition{
		column:   column,
		operator: "IN",
		value:    values,
		logic:    logic,
	})
	qb.params = append(qb.params, values...)
	return qb
}

// WhereNull adds a WHERE IS NULL condition.
func (qb *QueryBuilder) WhereNull(column string) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	logic := "AND"
	if len(qb.wheres) == 0 {
		logic = ""
	}
	qb.wheres = append(qb.wheres, condition{column: column, operator: "IS NULL", logic: logic})
	return qb
}

// WhereNotNull adds a WHERE IS NOT NULL condition.
func (qb *QueryBuilder) WhereNotNull(column string) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	logic := "AND"
	if len(qb.wheres) == 0 {
		logic = ""
	}
	qb.wheres = append(qb.wheres, condition{column: column, operator: "IS NOT NULL", logic: logic})
	return qb
}

// Join adds an INNER JOIN clause.
func (qb *QueryBuilder) Join(table, on string) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	qb.joins = append(qb.joins, joinClause{joinType: "INNER", table: table, on: on})
	return qb
}

// LeftJoin adds a LEFT JOIN clause.
func (qb *QueryBuilder) LeftJoin(table, on string) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	qb.joins = append(qb.joins, joinClause{joinType: "LEFT", table: table, on: on})
	return qb
}

// RightJoin adds a RIGHT JOIN clause.
func (qb *QueryBuilder) RightJoin(table, on string) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	qb.joins = append(qb.joins, joinClause{joinType: "RIGHT", table: table, on: on})
	return qb
}

// OrderBy adds an ORDER BY clause.
func (qb *QueryBuilder) OrderBy(column string, desc ...bool) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	isDesc := false
	if len(desc) > 0 {
		isDesc = desc[0]
	}
	qb.orderBy = append(qb.orderBy, order{column: column, desc: isDesc})
	return qb
}

// GroupBy adds a GROUP BY clause.
func (qb *QueryBuilder) GroupBy(columns ...string) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	qb.groupBy = append(qb.groupBy, columns...)
	return qb
}

// Having adds a HAVING clause.
func (qb *QueryBuilder) Having(condition string) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	qb.having = condition
	return qb
}

// Limit sets the LIMIT value.
func (qb *QueryBuilder) Limit(n int) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	qb.limitVal = n
	return qb
}

// Offset sets the OFFSET value.
func (qb *QueryBuilder) Offset(n int) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	qb.offsetVal = n
	return qb
}

// Returning adds a RETURNING clause.
func (qb *QueryBuilder) Returning(columns ...string) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	qb.returning = columns
	return qb
}

// Union adds a UNION clause.
func (qb *QueryBuilder) Union(other *QueryBuilder) *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	qb.unionSQL = other.Build()
	return qb
}

// Build constructs the SQL string from the query builder state.
func (qb *QueryBuilder) Build() string {
	qb.mu.Lock()
	defer qb.mu.Unlock()

	switch qb.op {
	case "SELECT":
		return qb.buildSelect()
	case "INSERT":
		return qb.buildInsert()
	case "UPDATE":
		return qb.buildUpdate()
	case "DELETE":
		return qb.buildDelete()
	default:
		return ""
	}
}

// Params returns the query parameters accumulated during building.
func (qb *QueryBuilder) Params() []interface{} {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	return qb.params
}

// Execute builds and executes the query using the provided client.
func (qb *QueryBuilder) Execute(ctx context.Context, client *Client) (*Result, error) {
	sql := qb.Build()
	return client.Query(ctx, sql, qb.Params()...)
}

// Exec executes the built query and returns affected rows.
func (qb *QueryBuilder) Exec(ctx context.Context, client *Client) (int64, error) {
	result, err := qb.Execute(ctx, client)
	if err != nil {
		return 0, err
	}
	return int64(result.RowCount), nil
}

// buildSelect constructs a SELECT statement.
func (qb *QueryBuilder) buildSelect() string {
	var b strings.Builder

	if len(qb.columns) == 0 {
		b.WriteString("SELECT *")
	} else {
		b.WriteString("SELECT ")
		b.WriteString(strings.Join(qb.columns, ", "))
	}

	b.WriteString(" FROM ")
	b.WriteString(qb.table)

	for _, j := range qb.joins {
		fmt.Fprintf(&b, " %s JOIN %s ON %s", j.joinType, j.table, j.on)
	}

	qb.writeWhere(&b)

	if len(qb.groupBy) > 0 {
		fmt.Fprintf(&b, " GROUP BY %s", strings.Join(qb.groupBy, ", "))
	}

	if qb.having != "" {
		fmt.Fprintf(&b, " HAVING %s", qb.having)
	}

	if len(qb.orderBy) > 0 {
		qb.writeOrderBy(&b)
	}

	if qb.limitVal > 0 {
		fmt.Fprintf(&b, " LIMIT %d", qb.limitVal)
	}

	if qb.offsetVal > 0 {
		fmt.Fprintf(&b, " OFFSET %d", qb.offsetVal)
	}

	if qb.unionSQL != "" {
		fmt.Fprintf(&b, " UNION %s", qb.unionSQL)
	}

	return b.String()
}

// buildInsert constructs an INSERT statement.
func (qb *QueryBuilder) buildInsert() string {
	var b strings.Builder
	b.WriteString("INSERT INTO ")
	b.WriteString(qb.table)

	if len(qb.columns) > 0 {
		fmt.Fprintf(&b, " (%s)", strings.Join(qb.columns, ", "))
	}

	if len(qb.values) > 0 {
		b.WriteString(" VALUES ")
		placeholders := make([]string, len(qb.values[0]))
		for i := range placeholders {
			placeholders[i] = "?"
		}
		rowStr := fmt.Sprintf("(%s)", strings.Join(placeholders, ", "))

		rows := make([]string, len(qb.values))
		for i := range rows {
			rows[i] = rowStr
		}
		b.WriteString(strings.Join(rows, ", "))
	}

	if len(qb.returning) > 0 {
		fmt.Fprintf(&b, " RETURNING %s", strings.Join(qb.returning, ", "))
	}

	return b.String()
}

// buildUpdate constructs an UPDATE statement.
func (qb *QueryBuilder) buildUpdate() string {
	var b strings.Builder
	b.WriteString("UPDATE ")
	b.WriteString(qb.table)

	if len(qb.sets) > 0 {
		b.WriteString(" SET ")
		sets := make([]string, len(qb.sets))
		for i, s := range qb.sets {
			sets[i] = fmt.Sprintf("%s = ?", s.column)
		}
		b.WriteString(strings.Join(sets, ", "))
	}

	qb.writeWhere(&b)

	if len(qb.returning) > 0 {
		fmt.Fprintf(&b, " RETURNING %s", strings.Join(qb.returning, ", "))
	}

	return b.String()
}

// buildDelete constructs a DELETE statement.
func (qb *QueryBuilder) buildDelete() string {
	var b strings.Builder
	b.WriteString("DELETE FROM ")
	b.WriteString(qb.table)

	qb.writeWhere(&b)

	if len(qb.returning) > 0 {
		fmt.Fprintf(&b, " RETURNING %s", strings.Join(qb.returning, ", "))
	}

	return b.String()
}

func (qb *QueryBuilder) writeWhere(b *strings.Builder) {
	if len(qb.wheres) == 0 {
		return
	}
	b.WriteString(" WHERE ")
	for i, w := range qb.wheres {
		if i > 0 {
			fmt.Fprintf(b, " %s ", w.logic)
		}
		switch w.operator {
		case "IN":
			vals, ok := w.value.([]interface{})
			if !ok {
				if arr, ok2 := w.value.([]string); ok2 {
					vals = make([]interface{}, len(arr))
					for i, v := range arr {
						vals[i] = v
					}
				}
			}
			ph := make([]string, len(vals))
			for i := range ph {
				ph[i] = "?"
			}
			fmt.Fprintf(b, "%s IN (%s)", w.column, strings.Join(ph, ", "))
		case "IS NULL", "IS NOT NULL":
			fmt.Fprintf(b, "%s %s", w.column, w.operator)
		default:
			fmt.Fprintf(b, "%s %s ?", w.column, w.operator)
		}
	}
}

func (qb *QueryBuilder) writeOrderBy(b *strings.Builder) {
	b.WriteString(" ORDER BY ")
	orders := make([]string, len(qb.orderBy))
	for i, o := range qb.orderBy {
		if o.desc {
			orders[i] = fmt.Sprintf("%s DESC", o.column)
		} else {
			orders[i] = fmt.Sprintf("%s ASC", o.column)
		}
	}
	b.WriteString(strings.Join(orders, ", "))
}

// Count builds and returns a SELECT COUNT(*) query from the current state.
func (qb *QueryBuilder) Count() *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	qb.columns = []string{"COUNT(*)"}
	qb.orderBy = nil
	qb.limitVal = 0
	qb.offsetVal = 0
	return qb
}

// Exists builds and returns a SELECT EXISTS query.
func (qb *QueryBuilder) Exists() *QueryBuilder {
	qb.mu.Lock()
	defer qb.mu.Unlock()
	qb.columns = []string{"1"}
	qb.limitVal = 1
	return qb
}

// SubQuery builds a subquery string.
func (qb *QueryBuilder) SubQuery(alias string) string {
	return fmt.Sprintf("(%s) AS %s", qb.Build(), alias)
}
