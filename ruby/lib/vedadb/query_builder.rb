# frozen_string_literal: true

module VedaDB
  # Fluent query builder for VedaDB.
  #
  # Usage:
  #   db.table("users")
  #     .select("id", "name", "email")
  #     .where("age > ?", 21)
  #     .where("status = ?", "active")
  #     .order("name ASC")
  #     .limit(10)
  #     .execute
  #
  # Method chaining:
  #   results = db.table("products").where("price < ?", 100).order("price DESC").all
  #   count   = db.table("orders").where("status = ?", "pending").count
  #   first   = db.table("users").where("id = ?", 1).first
  class QueryBuilder
    attr_reader :client, :table_name, :select_columns, :wheres, :order_clause, :limit_count, :offset_count

    def initialize(client, table_name)
      @client         = client
      @table_name     = table_name
      @select_columns = ["*"]
      @wheres         = []
      @order_clause   = nil
      @limit_count    = nil
      @offset_count   = nil
      @joins          = []
      @group_by       = nil
      @having         = nil
    end

    # Specify columns to SELECT.
    def select(*columns)
      @select_columns = columns.flatten.map(&:to_s)
      self
    end

    # Add a WHERE condition (AND-combined).
    def where(condition, *binds)
      sql = if binds.empty?
              condition.to_s
            else
              interpolate(condition, binds)
            end
      @wheres << sql
      self
    end

    # Add an ORDER BY clause.
    def order(clause)
      @order_clause = clause.to_s
      self
    end
    alias order_by order

    # Add a LIMIT.
    def limit(n)
      @limit_count = n.to_i
      self
    end

    # Add an OFFSET.
    def offset(n)
      @offset_count = n.to_i
      self
    end

    # Add a JOIN clause.
    def join(table, on:, type: :inner)
      join_type = type.to_s.upcase
      @joins << "#{join_type} JOIN #{table} ON #{on}"
      self
    end

    # Add GROUP BY.
    def group(columns)
      @group_by = Array(columns).join(", ")
      self
    end

    # Add HAVING clause.
    def having(condition)
      @having = condition.to_s
      self
    end

    # -- execution --------------------------------------------------------

    # Execute the built query and return a Result.
    def execute
      @client.query(build_sql)
    end

    # Execute and return all rows as hashes.
    def all
      execute.to_hashes
    end

    # Execute and return the first row as a hash, or nil.
    def first
      limit(1).execute.first
    end

    # Execute and return a single column's values.
    def pluck(column)
      select(column).execute.pluck(column.to_s)
    end

    # Execute a COUNT(*) query.
    def count
      result = select("COUNT(*)")
              .execute
      return 0 if result.rows.nil? || result.rows.empty?

      result.rows.first[0].to_i
    end

    # Check if any rows match.
    def exists?
      count > 0
    end

    # Insert a row into the table.
    def insert(data)
      cols = data.keys.join(", ")
      vals = data.values.map { |v| format_value(v) }.join(", ")
      @client.query("INSERT INTO #{@table_name} (#{cols}) VALUES (#{vals});")
    end

    # Update rows matching current WHERE clauses.
    def update(data)
      raise QueryError, "UPDATE requires at least one WHERE clause" if @wheres.empty?

      set_clause = data.map { |k, v| "#{k} = #{format_value(v)}" }.join(", ")
      sql = "UPDATE #{@table_name} SET #{set_clause}"
      sql += " WHERE #{@wheres.join(' AND ')}" unless @wheres.empty?
      @client.query(sql + ";")
    end

    # Delete rows matching current WHERE clauses.
    def delete
      raise QueryError, "DELETE requires at least one WHERE clause" if @wheres.empty?

      sql = "DELETE FROM #{@table_name}"
      sql += " WHERE #{@wheres.join(' AND ')}" unless @wheres.empty?
      @client.query(sql + ";")
    end

    # Build the SQL string without executing.
    def to_sql
      build_sql
    end

    # -- cloning / chaining -----------------------------------------------

    # Return a new builder with merged conditions.
    def merge(other = nil)
      dup = clone
      if block_given?
        yield dup
        dup
      else
        dup
      end
    end

    private

    def build_sql
      parts = ["SELECT", @select_columns.join(", "), "FROM", @table_name]

      @joins.each { |j| parts << j }
      parts << "WHERE #{@wheres.join(' AND ')}" unless @wheres.empty?
      parts << "GROUP BY #{@group_by}" if @group_by
      parts << "HAVING #{@having}" if @having
      parts << "ORDER BY #{@order_clause}" if @order_clause
      parts << "LIMIT #{@limit_count}" if @limit_count
      parts << "OFFSET #{@offset_count}" if @offset_count

      parts.join(" ") + ";"
    end

    def interpolate(sql, params)
      params.each do |p|
        repl = case p
               when nil then "NULL"
               when String then "'#{p.gsub("'", "''")}'"
               when true then "TRUE"
               when false then "FALSE"
               else p.to_s
               end
        sql = sql.sub("?", repl)
      end
      sql
    end

    def format_value(value)
      case value
      when nil then "NULL"
      when String then "'#{value.gsub("'", "''")}'"
      when true then "TRUE"
      when false then "FALSE"
      else value.to_s
      end
    end
  end
end
