package vedadb

import (
	"reflect"
	"testing"
)

// Test struct for ORM
type TestUser struct {
	ID    int    `vedadb:"column:id;primary_key;auto_increment"`
	Name  string `vedadb:"column:name;not_null"`
	Email string `vedadb:"column:email;unique"`
	Age   int    `vedadb:"column:age;default:0"`
}

// TestModelMetadata validates struct tag parsing.
func TestParseStructMeta(t *testing.T) {
	fields := parseStructMeta(reflect.TypeOf(TestUser{}))
	if len(fields) != 4 {
		t.Fatalf("expected 4 fields, got %d", len(fields))
	}
	if fields[0].Column != "id" {
		t.Errorf("expected column 'id', got %s", fields[0].Column)
	}
	if !fields[0].IsPrimaryKey {
		t.Error("expected ID to be primary key")
	}
	if !fields[0].AutoIncrement {
		t.Error("expected ID to be auto_increment")
	}
	if fields[1].Column != "name" {
		t.Errorf("expected column 'name', got %s", fields[1].Column)
	}
	if !fields[1].NotNull {
		t.Error("expected Name to be not_null")
	}
	if fields[2].Column != "email" {
		t.Errorf("expected column 'email', got %s", fields[2].Column)
	}
	if !fields[2].IsUnique {
		t.Error("expected Email to be unique")
	}
	if fields[3].Column != "age" {
		t.Errorf("expected column 'age', got %s", fields[3].Column)
	}
	if fields[3].Default != "0" {
		t.Errorf("expected Age default '0', got %s", fields[3].Default)
	}
}

// TestTableName validates table name derivation.
func TestTableName(t *testing.T) {
	name := tableName(reflect.TypeOf(TestUser{}))
	if name != "test_user" {
		t.Errorf("expected table name 'test_user', got %s", name)
	}
}

// TestGoTypeToSQL validates Go to SQL type mapping.
func TestGoTypeToSQL(t *testing.T) {
	tests := []struct {
		goType   reflect.Type
		expected string
	}{
		{reflect.TypeOf(""), "TEXT"},
		{reflect.TypeOf(0), "INTEGER"},
		{reflect.TypeOf(int64(0)), "INTEGER"},
		{reflect.TypeOf(0.0), "REAL"},
		{reflect.TypeOf(true), "BOOLEAN"},
	}
	for _, tc := range tests {
		actual := goTypeToSQL(tc.goType)
		if actual != tc.expected {
			t.Errorf("goTypeToSQL(%v) = %s, expected %s", tc.goType, actual, tc.expected)
		}
	}
}

// TestORMCache validates metadata caching.
func TestORMCache(t *testing.T) {
	orm := &ORM{}
	meta1 := orm.getCachedMeta(reflect.TypeOf(TestUser{}))
	meta2 := orm.getCachedMeta(reflect.TypeOf(TestUser{}))
	if len(meta1) != len(meta2) {
		t.Error("cached metadata should have same length")
	}
}

// TestIsValidIdentifier validates SQL identifier validation.
func TestIsValidIdentifier(t *testing.T) {
	valid := []string{"users", "_test", "table_1", "Users"}
	invalid := []string{"", "1table", "table-name", "table.name", "table;drop"}
	for _, v := range valid {
		if !isValidIdentifier(v) {
			t.Errorf("'%s' should be a valid identifier", v)
		}
	}
	for _, iv := range invalid {
		if isValidIdentifier(iv) {
			t.Errorf("'%s' should be an invalid identifier", iv)
		}
	}
}
