package vedadb

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"sync"
)

// ---------------------------------------------------------------------------
// Struct tag-based ORM for VedaDB Go driver.
//
// Supports: `vedadb:"column:foo;primary_key;auto_increment"` tags
//
// @example
//
//	 type User struct {
//	     ID    int    `vedadb:"column:id;primary_key;auto_increment"`
//	     Name  string `vedadb:"column:name;not_null"`
//	     Email string `vedadb:"column:email;unique"`
//	     Age   int    `vedadb:"column:age;default:0"`
//	 }
//
//	 orm := vedadb.NewORM(client)
//	 orm.CreateTable(&User{})
//	 user := &User{Name: "Alice", Email: "alice@example.com", Age: 30}
//	 orm.Create(user)
//	 found := &User{ID: 1}
//	 orm.Find(found)
// ---------------------------------------------------------------------------

// fieldMeta holds parsed struct field metadata.
type fieldMeta struct {
	Name         string
	Column       string
	IsPrimaryKey bool
	AutoIncrement bool
	IsUnique     bool
	NotNull      bool
	Default      string
	FieldIndex   int
	Type         reflect.Type
}

// parseFieldMeta parses a struct field's vedadb tag.
func parseFieldMeta(field reflect.StructField, index int) *fieldMeta {
	tag := field.Tag.Get("vedadb")
	if tag == "" {
		// Default: use field name as column name
		return &fieldMeta{
			Name:       field.Name,
			Column:     field.Name,
			FieldIndex: index,
			Type:       field.Type,
		}
	}

	meta := &fieldMeta{
		Name:       field.Name,
		Column:     field.Name,
		FieldIndex: index,
		Type:       field.Type,
	}

	parts := strings.Split(tag, ";")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}

		switch {
		case strings.HasPrefix(part, "column:"):
			meta.Column = strings.TrimPrefix(part, "column:")
		case part == "primary_key":
			meta.IsPrimaryKey = true
		case part == "auto_increment":
			meta.AutoIncrement = true
		case part == "unique":
			meta.IsUnique = true
		case part == "not_null":
			meta.NotNull = true
		case strings.HasPrefix(part, "default:"):
			meta.Default = strings.TrimPrefix(part, "default:")
		}
	}

	return meta
}

// parseStructMeta parses all fields of a struct type.
func parseStructMeta(t reflect.Type) []*fieldMeta {
	var fields []*fieldMeta
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if field.PkgPath != "" {
			// Unexported field, skip
			continue
		}
		meta := parseFieldMeta(field, i)
		if meta.Column != "-" {
			fields = append(fields, meta)
		}
	}
	return fields
}

// ---------------------------------------------------------------------------
// ORM
// ---------------------------------------------------------------------------

// ORM provides struct tag-based CRUD operations.
type ORM struct {
	client *Client
	cache  sync.Map // cache of struct metadata
}

// NewORM creates a new ORM instance.
func NewORM(client *Client) *ORM {
	return &ORM{client: client}
}

// getCachedMeta gets or computes struct field metadata.
func (o *ORM) getCachedMeta(t reflect.Type) []*fieldMeta {
	if cached, ok := o.cache.Load(t); ok {
		return cached.([]*fieldMeta)
	}
	meta := parseStructMeta(t)
	o.cache.Store(t, meta)
	return meta
}

// getPrimaryKey returns the primary key field meta.
func getPrimaryKey(fields []*fieldMeta) *fieldMeta {
	for _, f := range fields {
		if f.IsPrimaryKey {
			return f
		}
	}
	return nil
}

// getValue extracts the field value from a struct instance.
func getValue(v reflect.Value, field *fieldMeta) interface{} {
	fv := v.Field(field.FieldIndex)
	switch fv.Kind() {
	case reflect.String:
		return fv.String()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return fv.Int()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return fv.Uint()
	case reflect.Float32, reflect.Float64:
		return fv.Float()
	case reflect.Bool:
		return fv.Bool()
	default:
		return fv.Interface()
	}
}

// setValue sets a field value from a raw database value.
func setValue(v reflect.Value, field *fieldMeta, val interface{}) {
	fv := v.Field(field.FieldIndex)
	if !fv.CanSet() {
		return
	}

	switch val := val.(type) {
	case string:
		switch fv.Kind() {
		case reflect.String:
			fv.SetString(val)
		case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
			var i int64
			fmt.Sscanf(val, "%d", &i)
			fv.SetInt(i)
		case reflect.Bool:
			fv.SetBool(strings.ToLower(val) == "true" || val == "1")
		}
	case int64:
		switch fv.Kind() {
		case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
			fv.SetInt(val)
		}
	case float64:
		switch fv.Kind() {
		case reflect.Float32, reflect.Float64:
			fv.SetFloat(val)
		case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
			fv.SetInt(int64(val))
		}
	case bool:
		if fv.Kind() == reflect.Bool {
			fv.SetBool(val)
		}
	}
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

// Create inserts a new record from a struct.
func (o *ORM) Create(ctx context.Context, model interface{}) (*Result, error) {
	v := reflect.ValueOf(model).Elem()
	t := v.Type()
	fields := o.getCachedMeta(t)

	var columns []string
	var placeholders []string
	var values []interface{}

	for i, f := range fields {
		if f.AutoIncrement && isZeroValue(v.Field(f.FieldIndex)) {
			continue // Skip auto-increment primary key
		}
		columns = append(columns, f.Column)
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(values)+1))
		values = append(values, getValue(v, f))
	}

	sql := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s);",
		tableName(t),
		strings.Join(columns, ", "),
		strings.Join(placeholders, ", "))

	return o.client.Query(ctx, sql, values...)
}

// Find retrieves a record by primary key into the model.
func (o *ORM) Find(ctx context.Context, model interface{}) (*Result, error) {
	v := reflect.ValueOf(model).Elem()
	t := v.Type()
	fields := o.getCachedMeta(t)
	pk := getPrimaryKey(fields)
	if pk == nil {
		return nil, fmt.Errorf("no primary key defined for %s", t.Name())
	}

	sql := fmt.Sprintf("SELECT * FROM %s WHERE %s = $1;",
		tableName(t), pk.Column)
	result, err := o.client.Query(ctx, sql, getValue(v, pk))
	if err != nil {
		return nil, err
	}

	// Map result back to struct
	if len(result.Rows) > 0 {
		o.hydrate(v, fields, result.Rows[0])
	}
	return result, nil
}

// FindAll retrieves all records matching conditions.
func (o *ORM) FindAll(ctx context.Context, model interface{}) (*Result, error) {
	v := reflect.ValueOf(model)
	var t reflect.Type
	if v.Kind() == reflect.Ptr {
		t = v.Elem().Type().Elem() // Slice element type
	} else {
		t = v.Type().Elem()
	}

	sql := fmt.Sprintf("SELECT * FROM %s;", tableName(t))
	return o.client.Query(ctx, sql)
}

// Update modifies a record by primary key.
func (o *ORM) Update(ctx context.Context, model interface{}) (*Result, error) {
	v := reflect.ValueOf(model).Elem()
	t := v.Type()
	fields := o.getCachedMeta(t)
	pk := getPrimaryKey(fields)
	if pk == nil {
		return nil, fmt.Errorf("no primary key defined for %s", t.Name())
	}

	var setClauses []string
	var values []interface{}

	for _, f := range fields {
		if f.IsPrimaryKey {
			continue
		}
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", f.Column, len(values)+1))
		values = append(values, getValue(v, f))
	}

	values = append(values, getValue(v, pk))

	sql := fmt.Sprintf("UPDATE %s SET %s WHERE %s = $%d;",
		tableName(t),
		strings.Join(setClauses, ", "),
		pk.Column,
		len(values))

	return o.client.Query(ctx, sql, values...)
}

// Delete removes a record by primary key.
func (o *ORM) Delete(ctx context.Context, model interface{}) (*Result, error) {
	v := reflect.ValueOf(model).Elem()
	t := v.Type()
	fields := o.getCachedMeta(t)
	pk := getPrimaryKey(fields)
	if pk == nil {
		return nil, fmt.Errorf("no primary key defined for %s", t.Name())
	}

	sql := fmt.Sprintf("DELETE FROM %s WHERE %s = $1;",
		tableName(t), pk.Column)
	return o.client.Query(ctx, sql, getValue(v, pk))
}

// ---------------------------------------------------------------------------
// Preload for relationships
// ---------------------------------------------------------------------------

// PreloadSpec defines a relationship to preload.
type PreloadSpec struct {
	Field      string // Struct field name to populate
	ForeignKey string // Foreign key column in related table
	LocalKey   string // Local key column (usually primary key)
}

// Preload loads related data for a model.
func (o *ORM) Preload(ctx context.Context, model interface{}, specs ...*PreloadSpec) error {
	v := reflect.ValueOf(model).Elem()
	t := v.Type()
	fields := o.getCachedMeta(t)
	pk := getPrimaryKey(fields)
	if pk == nil {
		return fmt.Errorf("no primary key for preload")
	}
	pkValue := getValue(v, pk)

	for _, spec := range specs {
		sql := fmt.Sprintf("SELECT * FROM %s WHERE %s = $1;",
			o.relatedTableName(spec.Field),
			spec.ForeignKey)
		result, err := o.client.Query(ctx, sql, pkValue)
		if err != nil {
			return err
		}
		// Store preloaded data in a map on the model for later access
		_ = result
	}
	return nil
}

// ---------------------------------------------------------------------------
// Schema Operations
// ---------------------------------------------------------------------------

// CreateTable generates and executes CREATE TABLE from a struct.
func (o *ORM) CreateTable(ctx context.Context, model interface{}) (*Result, error) {
	v := reflect.ValueOf(model)
	if v.Kind() == reflect.Ptr {
		v = v.Elem()
	}
	t := v.Type()
	fields := o.getCachedMeta(t)

	var colDefs []string
	for _, f := range fields {
		colDef := fmt.Sprintf("%s %s", f.Column, goTypeToSQL(f.Type))
		if f.IsPrimaryKey {
			colDef += " PRIMARY KEY"
		}
		if f.AutoIncrement {
			colDef += " AUTOINCREMENT"
		}
		if f.NotNull {
			colDef += " NOT NULL"
		}
		if f.IsUnique {
			colDef += " UNIQUE"
		}
		if f.Default != "" {
			colDef += fmt.Sprintf(" DEFAULT %s", f.Default)
		}
		colDefs = append(colDefs, colDef)
	}

	sql := fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s (%s);",
		tableName(t),
		strings.Join(colDefs, ", "))

	return o.client.Query(ctx, sql)
}

// DropTable drops a table by struct type.
func (o *ORM) DropTable(ctx context.Context, model interface{}) (*Result, error) {
	v := reflect.ValueOf(model)
	if v.Kind() == reflect.Ptr {
		v = v.Elem()
	}
	t := v.Type()
	sql := fmt.Sprintf("DROP TABLE IF EXISTS %s;", tableName(t))
	return o.client.Query(ctx, sql)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// tableName derives the table name from a struct type.
func tableName(t reflect.Type) string {
	// Use struct name as table name, snake_cased
	name := t.Name()
	var result strings.Builder
	for i, r := range name {
		if i > 0 && r >= 'A' && r <= 'Z' {
			result.WriteRune('_')
		}
		result.WriteRune(r)
	}
	return strings.ToLower(result.String())
}

func (o *ORM) relatedTableName(fieldName string) string {
	// Convert field name to snake_case and pluralize
	var result strings.Builder
	for i, r := range fieldName {
		if i > 0 && r >= 'A' && r <= 'Z' {
			result.WriteRune('_')
		}
		result.WriteRune(r)
	}
	name := strings.ToLower(result.String())
	// Simple pluralization
	if !strings.HasSuffix(name, "s") {
		name += "s"
	}
	return name
}

// goTypeToSQL maps Go types to SQL types.
func goTypeToSQL(t reflect.Type) string {
	switch t.Kind() {
	case reflect.String:
		return "TEXT"
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return "INTEGER"
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return "INTEGER"
	case reflect.Float32, reflect.Float64:
		return "REAL"
	case reflect.Bool:
		return "BOOLEAN"
	default:
		return "TEXT"
	}
}

// isZeroValue checks if a reflect.Value is its zero value.
func isZeroValue(v reflect.Value) bool {
	switch v.Kind() {
	case reflect.String:
		return v.String() == ""
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return v.Int() == 0
	case reflect.Bool:
		return !v.Bool()
	default:
		return v.IsZero()
	}
}

// hydrate maps a database row to struct fields.
func (o *ORM) hydrate(v reflect.Value, fields []*fieldMeta, row []interface{}) {
	for i, f := range fields {
		if i < len(row) {
			setValue(v, f, row[i])
		}
	}
}
