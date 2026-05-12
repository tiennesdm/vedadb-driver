package io.vedadb;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import static org.junit.jupiter.api.Assertions.*;

import java.util.*;

/**
 * Query builder tests for VedaDB Java driver.
 */
class VedaQueryBuilderTest {

    @Nested
    @DisplayName("SELECT Tests")
    class SelectTests {

        @Test
        @DisplayName("Should build SELECT *")
        void testSelectAll() {
            QueryBuilder qb = new QueryBuilder().table("users");
            QueryResult result = qb.build();
            
            assertEquals("SELECT * FROM users", result.getSql());
            assertTrue(result.getParams().isEmpty());
        }

        @Test
        @DisplayName("Should build SELECT with columns")
        void testSelectColumns() {
            QueryBuilder qb = new QueryBuilder()
                .table("users")
                .select("id", "name", "email");
            QueryResult result = qb.build();
            
            assertEquals("SELECT id, name, email FROM users", result.getSql());
        }
    }

    @Nested
    @DisplayName("WHERE Tests")
    class WhereTests {

        @Test
        @DisplayName("Should build single WHERE")
        void testSingleWhere() {
            QueryBuilder qb = new QueryBuilder()
                .table("users")
                .where("id = ?", 1);
            QueryResult result = qb.build();
            
            assertTrue(result.getSql().contains("WHERE id = ?"));
            assertEquals(List.of(1), result.getParams());
        }

        @Test
        @DisplayName("Should build multiple WHERE with AND")
        void testMultipleWhere() {
            QueryBuilder qb = new QueryBuilder()
                .table("users")
                .where("age > ?", 18)
                .where("active = ?", true);
            QueryResult result = qb.build();
            
            assertTrue(result.getSql().contains("AND"));
            assertEquals(List.of(18, true), result.getParams());
        }

        @Test
        @DisplayName("Should build OR WHERE")
        void testOrWhere() {
            QueryBuilder qb = new QueryBuilder()
                .table("users")
                .where("role = ?", "admin")
                .orWhere("role = ?", "moderator");
            QueryResult result = qb.build();
            
            assertTrue(result.getSql().contains("OR"));
        }

        @Test
        @DisplayName("Should build WHERE with IN clause")
        void testWhereIn() {
            QueryBuilder qb = new QueryBuilder()
                .table("users")
                .where("status IN (?, ?, ?)", "active", "pending", "approved");
            QueryResult result = qb.build();
            
            assertTrue(result.getSql().contains("IN"));
        }
    }

    @Nested
    @DisplayName("JOIN Tests")
    class JoinTests {

        @Test
        @DisplayName("Should build INNER JOIN")
        void testInnerJoin() {
            QueryBuilder qb = new QueryBuilder()
                .table("users")
                .select("users.name", "orders.total")
                .join("orders", "users.id = orders.user_id");
            QueryResult result = qb.build();
            
            assertTrue(result.getSql().contains("INNER JOIN orders"));
            assertTrue(result.getSql().contains("ON users.id = orders.user_id"));
        }

        @Test
        @DisplayName("Should build LEFT JOIN")
        void testLeftJoin() {
            QueryBuilder qb = new QueryBuilder()
                .table("users")
                .leftJoin("profiles", "users.id = profiles.user_id");
            QueryResult result = qb.build();
            
            assertTrue(result.getSql().contains("LEFT JOIN profiles"));
        }

        @Test
        @DisplayName("Should build RIGHT JOIN")
        void testRightJoin() {
            QueryBuilder qb = new QueryBuilder()
                .table("orders")
                .rightJoin("users", "orders.user_id = users.id");
            QueryResult result = qb.build();
            
            assertTrue(result.getSql().contains("RIGHT JOIN users"));
        }

        @Test
        @DisplayName("Should build multiple JOINs")
        void testMultipleJoins() {
            QueryBuilder qb = new QueryBuilder()
                .table("users")
                .join("orders", "users.id = orders.user_id")
                .join("products", "orders.product_id = products.id");
            QueryResult result = qb.build();
            
            int joinCount = countOccurrences(result.getSql(), "JOIN");
            assertEquals(2, joinCount);
        }
    }

    @Nested
    @DisplayName("ORDER BY Tests")
    class OrderByTests {

        @Test
        @DisplayName("Should build ORDER BY ASC")
        void testOrderByAsc() {
            QueryBuilder qb = new QueryBuilder()
                .table("users")
                .orderBy("name");
            QueryResult result = qb.build();
            
            assertTrue(result.getSql().contains("ORDER BY name ASC"));
        }

        @Test
        @DisplayName("Should build ORDER BY DESC")
        void testOrderByDesc() {
            QueryBuilder qb = new QueryBuilder()
                .table("users")
                .orderByDesc("created_at");
            QueryResult result = qb.build();
            
            assertTrue(result.getSql().contains("ORDER BY created_at DESC"));
        }

        @Test
        @DisplayName("Should build multiple ORDER BY")
        void testMultipleOrderBy() {
            QueryBuilder qb = new QueryBuilder()
                .table("users")
                .orderBy("status")
                .orderByDesc("created_at");
            QueryResult result = qb.build();
            
            assertTrue(result.getSql().contains("status ASC"));
            assertTrue(result.getSql().contains("created_at DESC"));
        }
    }

    @Nested
    @DisplayName("Pagination Tests")
    class PaginationTests {

        @Test
        @DisplayName("Should build LIMIT")
        void testLimit() {
            QueryBuilder qb = new QueryBuilder()
                .table("users")
                .limit(10);
            QueryResult result = qb.build();
            
            assertTrue(result.getSql().contains("LIMIT ?"));
            assertTrue(result.getParams().contains(10));
        }

        @Test
        @DisplayName("Should build OFFSET")
        void testOffset() {
            QueryBuilder qb = new QueryBuilder()
                .table("users")
                .offset(20);
            QueryResult result = qb.build();
            
            assertTrue(result.getSql().contains("OFFSET ?"));
            assertTrue(result.getParams().contains(20));
        }

        @Test
        @DisplayName("Should build LIMIT and OFFSET together")
        void testLimitOffset() {
            QueryBuilder qb = new QueryBuilder()
                .table("users")
                .limit(10)
                .offset(20);
            QueryResult result = qb.build();
            
            assertTrue(result.getSql().contains("LIMIT ?"));
            assertTrue(result.getSql().contains("OFFSET ?"));
        }
    }

    @Nested
    @DisplayName("Complex Query Tests")
    class ComplexQueryTests {

        @Test
        @DisplayName("Should build complete complex query")
        void testComplexQuery() {
            QueryBuilder qb = new QueryBuilder()
                .table("users")
                .select("users.id", "users.name", "orders.total")
                .join("orders", "users.id = orders.user_id")
                .where("users.active = ?", true)
                .where("users.age >= ?", 18)
                .orderByDesc("orders.created_at")
                .limit(10);
            QueryResult result = qb.build();
            
            String sql = result.getSql();
            assertTrue(sql.contains("SELECT"));
            assertTrue(sql.contains("FROM users"));
            assertTrue(sql.contains("INNER JOIN orders"));
            assertTrue(sql.contains("WHERE"));
            assertTrue(sql.contains("ORDER BY"));
            assertTrue(sql.contains("LIMIT ?"));
            assertTrue(result.getParams().contains(true));
            assertTrue(result.getParams().contains(18));
        }

        @Test
        @DisplayName("Should build GROUP BY query")
        void testGroupBy() {
            QueryBuilder qb = new QueryBuilder()
                .table("orders")
                .select("status", "COUNT(*) as count")
                .groupBy("status");
            QueryResult result = qb.build();
            
            assertTrue(result.getSql().contains("GROUP BY status"));
        }

        @Test
        @DisplayName("Should support method chaining")
        void testChaining() {
            QueryBuilder qb = new QueryBuilder();
            QueryBuilder result = qb.table("test").select("id").where("id = ?", 1);
            
            assertSame(qb, result);
        }
    }

    private int countOccurrences(String str, String substr) {
        int count = 0;
        int idx = 0;
        while ((idx = str.indexOf(substr, idx)) != -1) {
            count++;
            idx += substr.length();
        }
        return count;
    }
}

/** QueryResult class */
class QueryResult {
    private final String sql;
    private final List<Object> params;

    QueryResult(String sql, List<Object> params) {
        this.sql = sql;
        this.params = params;
    }

    String getSql() { return sql; }
    List<Object> getParams() { return params; }
}

/** QueryBuilder implementation */
class QueryBuilder {
    private String table = "";
    private List<String> columns = new ArrayList<>();
    private List<WhereClause> whereClauses = new ArrayList<>();
    private List<JoinClause> joins = new ArrayList<>();
    private List<OrderClause> orderBy = new ArrayList<>();
    private List<String> groupBy = new ArrayList<>();
    private Integer limit = null;
    private Integer offset = null;
    private List<Object> params = new ArrayList<>();

    QueryBuilder table(String name) { this.table = name; return this; }
    
    QueryBuilder select(String... cols) {
        this.columns = new ArrayList<>(Arrays.asList(cols));
        return this;
    }
    
    QueryBuilder where(String condition, Object... ps) {
        whereClauses.add(new WhereClause("AND", condition));
        params.addAll(Arrays.asList(ps));
        return this;
    }
    
    QueryBuilder orWhere(String condition, Object... ps) {
        whereClauses.add(new WhereClause("OR", condition));
        params.addAll(Arrays.asList(ps));
        return this;
    }
    
    QueryBuilder join(String table, String on) {
        joins.add(new JoinClause("INNER", table, on));
        return this;
    }
    
    QueryBuilder leftJoin(String table, String on) {
        joins.add(new JoinClause("LEFT", table, on));
        return this;
    }
    
    QueryBuilder rightJoin(String table, String on) {
        joins.add(new JoinClause("RIGHT", table, on));
        return this;
    }
    
    QueryBuilder orderBy(String column) {
        orderBy.add(new OrderClause(column, false));
        return this;
    }
    
    QueryBuilder orderByDesc(String column) {
        orderBy.add(new OrderClause(column, true));
        return this;
    }
    
    QueryBuilder groupBy(String... columns) {
        groupBy.addAll(Arrays.asList(columns));
        return this;
    }
    
    QueryBuilder limit(int n) {
        limit = n;
        params.add(n);
        return this;
    }
    
    QueryBuilder offset(int n) {
        offset = n;
        params.add(n);
        return this;
    }

    QueryResult build() {
        StringBuilder sql = new StringBuilder();
        
        // SELECT
        if (columns.isEmpty()) {
            sql.append("SELECT *");
        } else {
            sql.append("SELECT ").append(String.join(", ", columns));
        }
        
        // FROM
        sql.append(" FROM ").append(table);
        
        // JOINS
        for (JoinClause j : joins) {
            sql.append(" ").append(j.type).append(" JOIN ").append(j.table)
               .append(" ON ").append(j.on);
        }
        
        // WHERE
        for (int i = 0; i < whereClauses.size(); i++) {
            WhereClause w = whereClauses.get(i);
            if (i == 0) sql.append(" WHERE ");
            else sql.append(" ").append(w.op).append(" ");
            sql.append(w.condition);
        }
        
        // GROUP BY
        if (!groupBy.isEmpty()) {
            sql.append(" GROUP BY ").append(String.join(", ", groupBy));
        }
        
        // ORDER BY
        if (!orderBy.isEmpty()) {
            sql.append(" ORDER BY ");
            List<String> parts = new ArrayList<>();
            for (OrderClause o : orderBy) {
                parts.add(o.desc ? o.column + " DESC" : o.column + " ASC");
            }
            sql.append(String.join(", ", parts));
        }
        
        // LIMIT
        if (limit != null) sql.append(" LIMIT ?");
        
        // OFFSET
        if (offset != null) sql.append(" OFFSET ?");
        
        return new QueryResult(sql.toString(), new ArrayList<>(params));
    }
}

record WhereClause(String op, String condition) {}
record JoinClause(String type, String table, String on) {}
record OrderClause(String column, boolean desc) {}
