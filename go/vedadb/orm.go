package vedadb

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"unicode"
)

// ---------------------------------------------------------------------------
// Basic ORM
// ---------------------------------------------------------------------------

// Model is the interface that all ORM models must implement.
type Model interface {
	TableName() string
}

// TableNamer can be implemented to customize table names.
type TableNamer interface {
	TableName() string
}

// FieldMapping holds the mapping between struct fields and database columns.
type FieldMapping struct {
	FieldName  string
	ColumnName string
	Type       reflect.Type
	IsPrimary  bool
	IsAuto     bool
	IsNullable bool
	Tags       map[string]string
}

// ModelSchema holds the parsed schema for a model type.
type ModelSchema struct {
	TableName   string
	Fields      []FieldMapping
	PrimaryKey  string
	FieldByName map[string]FieldMapping
	ColumnMap   map[string]string // column -> field
	mu          sync.RWMutex
}

// ORM provides a basic object-relational mapping layer.
type ORM struct {
	client    *Client
	schemas   sync.Map // map[reflect.Type]*ModelSchema
	tableMu   sync.RWMutex
}

// NewORM creates a new ORM instance.
func NewORM(client *Client) *ORM {
	return &ORM{
		client: client,
	}
}

// Register parses and registers a model's schema.
func (o *ORM) Register(model interface{}) (*ModelSchema, error) {
	t := reflect.TypeOf(model)
	if t.Kind() == reflect.Ptr {
		t = t.Elem()
	}
	if t.Kind() != reflect.Struct {
		return nil, NewValidationError("model must be a struct or pointer to struct")
	}

	schema := o.parseSchema(t, model)
	o.schemas.Store(t, schema)
	return schema, nil
}

// parseSchema extracts field mappings from a struct type.
func (o *ORM) parseSchema(t reflect.Type, model interface{}) *ModelSchema {
	// Determine table name
	tableName := toSnakeCase(t.Name()) + "s"
	if tn, ok := model.(TableNamer); ok {
		tableName = tn.TableName()
	} else {
		// Try to call TableName via reflection
		m := reflect.ValueOf(model)
		method := m.MethodByName("TableName")
		if method.IsValid() {
			results := method.Call(nil)
			if len(results) > 0 {
				tableName = results[0].String()
			}
		}
	}

	schema := &ModelSchema{
		TableName:   tableName,
		Fields:      make([]FieldMapping, 0, t.NumField()),
		FieldByName: make(map[string]FieldMapping),
		ColumnMap:   make(map[string]string),
	}

	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)

		// Skip unexported fields
		if field.PkgPath != "" {
			continue
		}

		// Parse tags
		tags := parseTags(field.Tag)
		if tags["vedadb"] == "-" {
			continue
		}

		columnName := tags["column"]
		if columnName == "" {
			columnName = toSnakeCase(field.Name)
		}

		fm := FieldMapping{
			FieldName:  field.Name,
			ColumnName: columnName,
			Type:       field.Type,
			IsPrimary:  tags["primary"] == "true" || tags["pk"] == "true",
			IsAuto:     tags["auto"] == "true" || tags["autoincrement"] == "true",
			IsNullable: tags["nullable"] == "true",
			Tags:       tags,
		}

		schema.Fields = append(schema.Fields, fm)
		schema.FieldByName[field.Name] = fm
		schema.ColumnMap[columnName] = field.Name

		if fm.IsPrimary {
			schema.PrimaryKey = columnName
		}
	}

	return schema
}

// getSchema retrieves the schema for a model type.
func (o *ORM) getSchema(model interface{}) (*ModelSchema, error) {
	t := reflect.TypeOf(model)
	if t.Kind() == reflect.Ptr {
		t = t.Elem()
	}

	if val, ok := o.schemas.Load(t); ok {
		return val.(*ModelSchema), nil
	}

	return o.Register(model)
}

// Insert inserts a model into the database.
func (o *ORM) Insert(ctx context.Context, model interface{}) error {
	schema, err := o.getSchema(model)
	if err != nil {
		return err
	}

	v := reflect.ValueOf(model)
	if v.Kind() == reflect.Ptr {
		v = v.Elem()
	}

	columns := make([]string, 0, len(schema.Fields))
	placeholders := make([]string, 0, len(schema.Fields))
	values := make([]interface{}, 0, len(schema.Fields))

	for _, field := range schema.Fields {
		if field.IsAuto {
			continue // Skip auto-increment fields
		}

		fv := v.FieldByName(field.FieldName)
		columns = append(columns, field.ColumnName)
		placeholders = append(placeholders, "?")
		values = append(values, fv.Interface())
	}

	sql := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
		schema.TableName,
		strings.Join(columns, ", "),
		strings.Join(placeholders, ", "))

	_, err = o.client.Exec(ctx, sql, values...)
	return err
}

// FindByID retrieves a model by its primary key.
func (o *ORM) FindByID(ctx context.Context, model interface{}, id interface{}) error {
	schema, err := o.getSchema(model)
	if err != nil {
		return err
	}

	if schema.PrimaryKey == "" {
		return NewValidationError("no primary key defined for model")
	}

	sql := fmt.Sprintf("SELECT %s FROM %s WHERE %s = ?",
		o.selectColumns(schema),
		schema.TableName,
		schema.PrimaryKey)

	result, err := o.client.Query(ctx, sql, id)
	if err != nil {
		return err
	}

	if len(result.Rows) == 0 {
		return NewQueryError("record not found")
	}

	return o.scanRow(result, model, schema)
}

// FindAll retrieves all records for a model type.
func (o *ORM) FindAll(ctx context.Context, slice interface{}) error {
	sliceVal := reflect.ValueOf(slice)
	if sliceVal.Kind() != reflect.Ptr || sliceVal.Elem().Kind() != reflect.Slice {
		return NewValidationError("slice must be a pointer to a slice")
	}

	elemType := sliceVal.Elem().Type().Elem()
	if elemType.Kind() == reflect.Ptr {
		elemType = elemType.Elem()
	}

	// Create a dummy instance to get schema
	dummy := reflect.New(elemType).Interface()
	schema, err := o.getSchema(dummy)
	if err != nil {
		return err
	}

	sql := fmt.Sprintf("SELECT %s FROM %s", o.selectColumns(schema), schema.TableName)
	result, err := o.client.Query(ctx, sql)
	if err != nil {
		return err
	}

	return o.scanRows(result, slice, schema, elemType)
}

// FindWhere retrieves records matching a WHERE condition.
func (o *ORM) FindWhere(ctx context.Context, slice interface{}, where string, args ...interface{}) error {
	sliceVal := reflect.ValueOf(slice)
	if sliceVal.Kind() != reflect.Ptr || sliceVal.Elem().Kind() != reflect.Slice {
		return NewValidationError("slice must be a pointer to a slice")
	}

	elemType := sliceVal.Elem().Type().Elem()
	if elemType.Kind() == reflect.Ptr {
		elemType = elemType.Elem()
	}

	dummy := reflect.New(elemType).Interface()
	schema, err := o.getSchema(dummy)
	if err != nil {
		return err
	}

	sql := fmt.Sprintf("SELECT %s FROM %s WHERE %s",
		o.selectColumns(schema), schema.TableName, where)
	result, err := o.client.Query(ctx, sql, args...)
	if err != nil {
		return err
	}

	return o.scanRows(result, slice, schema, elemType)
}

// Update updates a model in the database.
func (o *ORM) Update(ctx context.Context, model interface{}) error {
	schema, err := o.getSchema(model)
	if err != nil {
		return err
	}

	if schema.PrimaryKey == "" {
		return NewValidationError("no primary key defined for model")
	}

	v := reflect.ValueOf(model)
	if v.Kind() == reflect.Ptr {
		v = v.Elem()
	}

	sets := make([]string, 0)
	values := make([]interface{}, 0)
	var pkValue interface{}

	for _, field := range schema.Fields {
		fv := v.FieldByName(field.FieldName)
		if field.IsPrimary {
			pkValue = fv.Interface()
			continue
		}
		sets = append(sets, fmt.Sprintf("%s = ?", field.ColumnName))
		values = append(values, fv.Interface())
	}

	if pkValue == nil {
		return NewValidationError("primary key value is nil")
	}
	values = append(values, pkValue)

	sql := fmt.Sprintf("UPDATE %s SET %s WHERE %s = ?",
		schema.TableName,
		strings.Join(sets, ", "),
		schema.PrimaryKey)

	_, err = o.client.Exec(ctx, sql, values...)
	return err
}

// Delete deletes a model from the database.
func (o *ORM) Delete(ctx context.Context, model interface{}) error {
	schema, err := o.getSchema(model)
	if err != nil {
		return err
	}

	if schema.PrimaryKey == "" {
		return NewValidationError("no primary key defined for model")
	}

	v := reflect.ValueOf(model)
	if v.Kind() == reflect.Ptr {
		v = v.Elem()
	}

	pkField := schema.FieldByName[schema.ColumnMap[schema.PrimaryKey]]
	pkValue := v.FieldByName(pkField.FieldName).Interface()

	sql := fmt.Sprintf("DELETE FROM %s WHERE %s = ?",
		schema.TableName, schema.PrimaryKey)

	_, err = o.client.Exec(ctx, sql, pkValue)
	return err
}

// DeleteByID deletes a record by its primary key.
func (o *ORM) DeleteByID(ctx context.Context, model interface{}, id interface{}) error {
	schema, err := o.getSchema(model)
	if err != nil {
		return err
	}

	if schema.PrimaryKey == "" {
		return NewValidationError("no primary key defined for model")
	}

	sql := fmt.Sprintf("DELETE FROM %s WHERE %s = ?",
		schema.TableName, schema.PrimaryKey)

	_, err = o.client.Exec(ctx, sql, id)
	return err
}

// Count returns the total count of records.
func (o *ORM) Count(ctx context.Context, model interface{}) (int64, error) {
	schema, err := o.getSchema(model)
	if err != nil {
		return 0, err
	}

	sql := fmt.Sprintf("SELECT COUNT(*) FROM %s", schema.TableName)
	result, err := o.client.Query(ctx, sql)
	if err != nil {
		return 0, err
	}

	if len(result.Rows) == 0 || len(result.Rows[0]) == 0 {
		return 0, nil
	}

	var count int64
	fmt.Sscanf(result.Rows[0][0], "%d", &count)
	return count, nil
}

// selectColumns generates the SELECT column list.
func (o *ORM) selectColumns(schema *ModelSchema) string {
	columns := make([]string, 0, len(schema.Fields))
	for _, field := range schema.Fields {
		columns = append(columns, field.ColumnName)
	}
	return strings.Join(columns, ", ")
}

// scanRow scans a single row into a model.
func (o *ORM) scanRow(result *Result, model interface{}, schema *ModelSchema) error {
	if len(result.Rows) == 0 {
		return NewQueryError("no rows returned")
	}

	v := reflect.ValueOf(model)
	if v.Kind() == reflect.Ptr {
		v = v.Elem()
	}

	row := result.Rows[0]
	colIdx := make(map[string]int)
	for i, col := range result.Columns {
		colIdx[col] = i
	}

	for _, field := range schema.Fields {
		idx, ok := colIdx[field.ColumnName]
		if !ok || idx >= len(row) {
			continue
		}

		fv := v.FieldByName(field.FieldName)
		if !fv.IsValid() || !fv.CanSet() {
			continue
		}

		o.setFieldValue(fv, row[idx], field.Type)
	}

	return nil
}

// scanRows scans multiple rows into a slice.
func (o *ORM) scanRows(result *Result, slice interface{}, schema *ModelSchema, elemType reflect.Type) error {
	sliceVal := reflect.ValueOf(slice).Elem()
	colIdx := make(map[string]int)
	for i, col := range result.Columns {
		colIdx[col] = i
	}

	for _, row := range result.Rows {
		elem := reflect.New(elemType).Elem()

		for _, field := range schema.Fields {
			idx, ok := colIdx[field.ColumnName]
			if !ok || idx >= len(row) {
				continue
			}

			fv := elem.FieldByName(field.FieldName)
			if !fv.IsValid() || !fv.CanSet() {
				continue
			}

			o.setFieldValue(fv, row[idx], field.Type)
		}

		if sliceVal.Type().Elem().Kind() == reflect.Ptr {
			newElem := reflect.New(elemType)
			newElem.Elem().Set(elem)
			sliceVal.Set(reflect.Append(sliceVal, newElem))
		} else {
			sliceVal.Set(reflect.Append(sliceVal, elem))
		}
	}

	return nil
}

// setFieldValue sets a struct field from a string value.
func (o *ORM) setFieldValue(fv reflect.Value, val string, ft reflect.Type) {
	if val == "" {
		return
	}

	switch fv.Kind() {
	case reflect.String:
		fv.SetString(val)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		var i int64
		fmt.Sscanf(val, "%d", &i)
		fv.SetInt(i)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		var i uint64
		fmt.Sscanf(val, "%d", &i)
		fv.SetUint(i)
	case reflect.Float32, reflect.Float64:
		var f float64
		fmt.Sscanf(val, "%f", &f)
		fv.SetFloat(f)
	case reflect.Bool:
		fv.SetBool(val == "true" || val == "1")
	}
}

// parseTags parses struct field tags into a map.
func parseTags(tag reflect.StructTag) map[string]string {
	result := make(map[string]string)

	// Parse "vedadb" tag
	if v := tag.Get("vedadb"); v != "" {
		parts := strings.Split(v, ";")
		for _, part := range parts {
			kv := strings.SplitN(part, ":", 2)
			if len(kv) == 2 {
				result[kv[0]] = kv[1]
			} else {
				result[kv[0]] = "true"
			}
		}
	}

	// Parse "column" tag
	if v := tag.Get("column"); v != "" {
		result["column"] = v
	}

	// Parse "json" tag for column name fallback
	if v := tag.Get("json"); v != "" && result["column"] == "" {
		parts := strings.Split(v, ",")
		if parts[0] != "-" {
			result["column"] = parts[0]
		}
	}

	// Parse "pk" tag
	if tag.Get("pk") == "true" || tag.Get("primary") == "true" {
		result["primary"] = "true"
	}

	return result
}

// toSnakeCase converts CamelCase to snake_case.
func toSnakeCase(s string) string {
	var result strings.Builder
	for i, r := range s {
		if unicode.IsUpper(r) {
			if i > 0 {
				result.WriteByte('_')
			}
			result.WriteRune(unicode.ToLower(r))
		} else {
			result.WriteRune(r)
		}
	}
	return result.String()
}

// AutoMigrate creates the table for a model if it doesn't exist.
func (o *ORM) AutoMigrate(ctx context.Context, models ...interface{}) error {
	for _, model := range models {
		schema, err := o.getSchema(model)
		if err != nil {
			return err
		}

		columns := make([]string, 0, len(schema.Fields))
		for _, field := range schema.Fields {
			colDef := fmt.Sprintf("%s %s", field.ColumnName, goTypeToSQLType(field.Type, field.IsAuto, field.IsNullable))
			if field.IsPrimary {
				colDef += " PRIMARY KEY"
			}
			columns = append(columns, colDef)
		}

		sql := fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s (%s)",
			schema.TableName, strings.Join(columns, ", "))

		if _, err := o.client.Exec(ctx, sql); err != nil {
			return fmt.Errorf("auto-migrate %s: %w", schema.TableName, err)
		}
	}
	return nil
}

// goTypeToSQLType maps Go types to SQL types.
func goTypeToSQLType(t reflect.Type, isAuto, isNullable bool) string {
	sqlType := "TEXT"
	switch t.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32:
		sqlType = "INTEGER"
	case reflect.Int64:
		if isAuto {
			sqlType = "INTEGER AUTOINCREMENT"
		} else {
			sqlType = "BIGINT"
		}
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		sqlType = "INTEGER"
	case reflect.Float32:
		sqlType = "REAL"
	case reflect.Float64:
		sqlType = "DOUBLE"
	case reflect.Bool:
		sqlType = "BOOLEAN"
	case reflect.String:
		sqlType = "TEXT"
	}

	if !isNullable && !isAuto {
		sqlType += " NOT NULL"
	}

	return sqlType
}
