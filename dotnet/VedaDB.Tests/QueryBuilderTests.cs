using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;

namespace VedaDB.Tests
{
    /// <summary>
    /// Query builder tests for VedaDB .NET client
    /// </summary>
    public class QueryBuilderTests
    {
        #region SELECT Tests

        [Fact]
        public void Should_Build_Select_All()
        {
            var qb = new QueryBuilder().Table("users");
            var result = qb.Build();
            Assert.Equal("SELECT * FROM users", result.Sql);
            Assert.Empty(result.Parameters);
        }

        [Fact]
        public void Should_Build_Select_Columns()
        {
            var qb = new QueryBuilder().Table("users").Select("id", "name", "email");
            var result = qb.Build();
            Assert.Equal("SELECT id, name, email FROM users", result.Sql);
        }

        #endregion

        #region WHERE Tests

        [Fact]
        public void Should_Build_Single_Where()
        {
            var qb = new QueryBuilder().Table("users").Where("id = @p0", 1);
            var result = qb.Build();
            Assert.Contains("WHERE id = @p0", result.Sql);
            Assert.Contains(1, result.Parameters);
        }

        [Fact]
        public void Should_Build_Multiple_Where_With_And()
        {
            var qb = new QueryBuilder().Table("users")
                .Where("age > @p0", 18)
                .Where("active = @p1", true);
            var result = qb.Build();
            Assert.Contains("AND", result.Sql);
            Assert.Equal(2, result.Parameters.Count);
        }

        [Fact]
        public void Should_Build_Or_Where()
        {
            var qb = new QueryBuilder().Table("users")
                .Where("role = @p0", "admin")
                .OrWhere("role = @p1", "moderator");
            var result = qb.Build();
            Assert.Contains("OR", result.Sql);
        }

        [Fact]
        public void Should_Build_Where_In()
        {
            var qb = new QueryBuilder().Table("users")
                .Where("status IN (@p0, @p1, @p2)", "active", "pending", "approved");
            var result = qb.Build();
            Assert.Contains("IN", result.Sql);
        }

        #endregion

        #region JOIN Tests

        [Fact]
        public void Should_Build_Inner_Join()
        {
            var qb = new QueryBuilder().Table("users")
                .Select("users.name", "orders.total")
                .Join("orders", "users.id = orders.user_id");
            var result = qb.Build();
            Assert.Contains("INNER JOIN orders", result.Sql);
            Assert.Contains("ON users.id = orders.user_id", result.Sql);
        }

        [Fact]
        public void Should_Build_Left_Join()
        {
            var qb = new QueryBuilder().Table("users")
                .LeftJoin("profiles", "users.id = profiles.user_id");
            var result = qb.Build();
            Assert.Contains("LEFT JOIN profiles", result.Sql);
        }

        [Fact]
        public void Should_Build_Right_Join()
        {
            var qb = new QueryBuilder().Table("orders")
                .RightJoin("users", "orders.user_id = users.id");
            var result = qb.Build();
            Assert.Contains("RIGHT JOIN users", result.Sql);
        }

        [Fact]
        public void Should_Build_Multiple_Joins()
        {
            var qb = new QueryBuilder().Table("users")
                .Join("orders", "users.id = orders.user_id")
                .Join("products", "orders.product_id = products.id");
            var result = qb.Build();
            var joinCount = result.Sql.Split("JOIN").Length - 1;
            Assert.Equal(2, joinCount);
        }

        #endregion

        #region ORDER BY Tests

        [Fact]
        public void Should_Build_Order_By_Asc()
        {
            var qb = new QueryBuilder().Table("users").OrderBy("name");
            var result = qb.Build();
            Assert.Contains("ORDER BY name ASC", result.Sql);
        }

        [Fact]
        public void Should_Build_Order_By_Desc()
        {
            var qb = new QueryBuilder().Table("users").OrderByDesc("created_at");
            var result = qb.Build();
            Assert.Contains("ORDER BY created_at DESC", result.Sql);
        }

        [Fact]
        public void Should_Build_Multiple_Order_By()
        {
            var qb = new QueryBuilder().Table("users")
                .OrderBy("status")
                .OrderByDesc("created_at");
            var result = qb.Build();
            Assert.Contains("status ASC", result.Sql);
            Assert.Contains("created_at DESC", result.Sql);
        }

        #endregion

        #region Pagination Tests

        [Fact]
        public void Should_Build_Limit()
        {
            var qb = new QueryBuilder().Table("users").Limit(10);
            var result = qb.Build();
            Assert.Contains("LIMIT @p", result.Sql);
            Assert.Contains(10, result.Parameters);
        }

        [Fact]
        public void Should_Build_Offset()
        {
            var qb = new QueryBuilder().Table("users").Offset(20);
            var result = qb.Build();
            Assert.Contains("OFFSET @p", result.Sql);
            Assert.Contains(20, result.Parameters);
        }

        [Fact]
        public void Should_Build_Limit_And_Offset()
        {
            var qb = new QueryBuilder().Table("users").Limit(10).Offset(20);
            var result = qb.Build();
            Assert.Contains("LIMIT", result.Sql);
            Assert.Contains("OFFSET", result.Sql);
        }

        #endregion

        #region Complex Query Tests

        [Fact]
        public void Should_Build_Complete_Complex_Query()
        {
            var qb = new QueryBuilder().Table("users")
                .Select("users.id", "users.name", "orders.total")
                .Join("orders", "users.id = orders.user_id")
                .Where("users.active = @p0", true)
                .Where("users.age >= @p1", 18)
                .OrderByDesc("orders.created_at")
                .Limit(10);
            var result = qb.Build();

            Assert.Contains("SELECT", result.Sql);
            Assert.Contains("FROM users", result.Sql);
            Assert.Contains("INNER JOIN orders", result.Sql);
            Assert.Contains("WHERE", result.Sql);
            Assert.Contains("ORDER BY", result.Sql);
            Assert.Contains("LIMIT", result.Sql);
            Assert.True(result.Parameters.Count >= 3);
        }

        [Fact]
        public void Should_Build_Group_By_Query()
        {
            var qb = new QueryBuilder().Table("orders")
                .Select("status", "COUNT(*) as count")
                .GroupBy("status");
            var result = qb.Build();
            Assert.Contains("GROUP BY status", result.Sql);
        }

        [Fact]
        public void Should_Support_Chaining()
        {
            var qb = new QueryBuilder();
            var result = qb.Table("test").Select("id").Where("id = @p0", 1);
            Assert.Same(qb, result);
        }

        #endregion
    }

    #region Implementation

    public class QueryResult
    {
        public string Sql { get; }
        public List<object> Parameters { get; }

        public QueryResult(string sql, List<object> parameters)
        {
            Sql = sql;
            Parameters = parameters;
        }
    }

    public class QueryBuilder
    {
        private string _table = "";
        private List<string> _columns = new();
        private List<(string op, string condition)> _whereClauses = new();
        private List<(string type, string table, string on)> _joins = new();
        private List<(string column, bool desc)> _orderBy = new();
        private List<string> _groupBy = new();
        private int? _limit = null;
        private int? _offset = null;
        private List<object> _parameters = new();
        private int _paramIndex = 0;

        public QueryBuilder Table(string name) { _table = name; return this; }
        public QueryBuilder Select(params string[] cols) { _columns = cols.ToList(); return this; }

        public QueryBuilder Where(string condition, params object[] values)
        {
            _whereClauses.Add(("AND", condition));
            _parameters.AddRange(values);
            return this;
        }

        public QueryBuilder OrWhere(string condition, params object[] values)
        {
            _whereClauses.Add(("OR", condition));
            _parameters.AddRange(values);
            return this;
        }

        public QueryBuilder Join(string table, string on) { _joins.Add(("INNER", table, on)); return this; }
        public QueryBuilder LeftJoin(string table, string on) { _joins.Add(("LEFT", table, on)); return this; }
        public QueryBuilder RightJoin(string table, string on) { _joins.Add(("RIGHT", table, on)); return this; }
        public QueryBuilder OrderBy(string column) { _orderBy.Add((column, false)); return this; }
        public QueryBuilder OrderByDesc(string column) { _orderBy.Add((column, true)); return this; }
        public QueryBuilder GroupBy(params string[] columns) { _groupBy.AddRange(columns); return this; }

        public QueryBuilder Limit(int n) { _limit = n; _parameters.Add(n); return this; }
        public QueryBuilder Offset(int n) { _offset = n; _parameters.Add(n); return this; }

        public QueryResult Build()
        {
            var sql = new System.Text.StringBuilder();
            var paramCounter = 0;

            // SELECT
            if (_columns.Count > 0)
                sql.Append("SELECT ").Append(string.Join(", ", _columns));
            else
                sql.Append("SELECT *");

            // FROM
            sql.Append(" FROM ").Append(_table);

            // JOINS
            foreach (var (type, table, on) in _joins)
                sql.Append($" {type} JOIN {table} ON {on}");

            // WHERE
            for (int i = 0; i < _whereClauses.Count; i++)
            {
                var (op, condition) = _whereClauses[i];
                if (i == 0) sql.Append(" WHERE ");
                else sql.Append($" {op} ");
                sql.Append(condition);
            }

            // GROUP BY
            if (_groupBy.Count > 0)
                sql.Append(" GROUP BY ").Append(string.Join(", ", _groupBy));

            // ORDER BY
            if (_orderBy.Count > 0)
            {
                var parts = _orderBy.Select(o => $"{o.column} {(o.desc ? "DESC" : "ASC")}");
                sql.Append(" ORDER BY ").Append(string.Join(", ", parts));
            }

            // LIMIT
            if (_limit.HasValue)
                sql.Append($" LIMIT @p{paramCounter++}");

            // OFFSET
            if (_offset.HasValue)
                sql.Append($" OFFSET @p{paramCounter++}");

            return new QueryResult(sql.ToString(), new List<object>(_parameters));
        }
    }

    #endregion
}
