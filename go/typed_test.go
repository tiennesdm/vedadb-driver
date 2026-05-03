// Pure-unit tests for typed-row + cursor parsing.
// No network — these test the pure-function paths only. Live
// server tests live in conformance/ once a test fixture is wired.

package vedadb

import (
	"testing"
)

func TestParseCell_Precedence(t *testing.T) {
	cases := []struct {
		in   string
		want TypedValueKind
	}{
		{"", KindNull},
		{"NULL", KindNull},
		{"null", KindNull},
		{"true", KindBool},
		{"TRUE", KindBool},
		{"FALSE", KindBool},
		{"42", KindInt},
		{"-7", KindInt},
		{"3.14", KindFloat},
		{"-2.5e10", KindFloat},
		{"alice", KindString},
		{"1.2.3", KindString}, // not a valid float
	}
	for _, c := range cases {
		got := parseCell(c.in)
		if got.Kind != c.want {
			t.Errorf("parseCell(%q) = %v; want %v", c.in, got.Kind, c.want)
		}
	}
	if parseCell("42").Int != 42 {
		t.Error("parseCell(42).Int != 42")
	}
	if parseCell("3.14").Float != 3.14 {
		t.Error("parseCell(3.14).Float != 3.14")
	}
	if !parseCell("true").Bool {
		t.Error("parseCell(true).Bool == false")
	}
}

func TestParseTypedResult_NilSafe(t *testing.T) {
	got := parseTypedResult(nil)
	if got == nil {
		t.Fatal("parseTypedResult(nil) returned nil; want empty TypedResult")
	}
	if len(got.Rows) != 0 {
		t.Errorf("got %d rows, want 0", len(got.Rows))
	}
}

func TestParseTypedResult_RoundTrip(t *testing.T) {
	r := &Result{
		Columns:  []string{"id", "name", "score", "active"},
		Rows:     [][]string{{"1", "alice", "9.5", "true"}, {"2", "bob", "NULL", "false"}},
		RowCount: 2,
	}
	tr := parseTypedResult(r)
	if tr.RowCount != 2 || len(tr.Rows) != 2 {
		t.Fatalf("rowcount=%d rows=%d", tr.RowCount, len(tr.Rows))
	}
	if v := tr.Rows[0]["id"]; v.Kind != KindInt || v.Int != 1 {
		t.Errorf("row0.id = {%v, %d}; want {Int, 1}", v.Kind, v.Int)
	}
	if v := tr.Rows[0]["name"]; v.Kind != KindString || v.Str != "alice" {
		t.Errorf("row0.name = {%v, %q}", v.Kind, v.Str)
	}
	if v := tr.Rows[0]["score"]; v.Kind != KindFloat || v.Float != 9.5 {
		t.Errorf("row0.score = {%v, %v}", v.Kind, v.Float)
	}
	if v := tr.Rows[0]["active"]; v.Kind != KindBool || !v.Bool {
		t.Errorf("row0.active = {%v, %v}", v.Kind, v.Bool)
	}
	// row1 score is NULL.
	if v := tr.Rows[1]["score"]; !v.IsNull {
		t.Errorf("row1.score IsNull=false; want true")
	}
}

func TestCursor_NilSafe(t *testing.T) {
	var c *Cursor
	if c.Next() {
		t.Error("nil cursor Next() returned true")
	}
	if c.Row() != nil {
		t.Error("nil cursor Row() != nil")
	}
	if c.RowTyped() != nil {
		t.Error("nil cursor RowTyped() != nil")
	}
	if c.Columns() != nil {
		t.Error("nil cursor Columns() != nil")
	}
	if err := c.Close(); err != nil {
		t.Errorf("nil cursor Close: %v", err)
	}
}

func TestCursor_BasicIteration(t *testing.T) {
	cur := cursorFromResult(&Result{
		Columns: []string{"k"},
		Rows:    [][]string{{"a"}, {"b"}, {"c"}},
	})
	defer cur.Close()
	visited := 0
	for cur.Next() {
		visited++
		if cur.Row() == nil {
			t.Errorf("Row() nil at visit %d", visited)
		}
	}
	if visited != 3 {
		t.Errorf("visited %d, want 3", visited)
	}
}

func TestCursor_BreakEarlyClose(t *testing.T) {
	cur := cursorFromResult(&Result{
		Columns: []string{"k"},
		Rows:    [][]string{{"a"}, {"b"}, {"c"}, {"d"}, {"e"}},
	})
	visited := 0
	for cur.Next() {
		visited++
		if visited == 2 {
			break
		}
	}
	if err := cur.Close(); err != nil {
		t.Errorf("Close: %v", err)
	}
	// Subsequent Next must return false.
	if cur.Next() {
		t.Error("Next true after Close")
	}
	if visited != 2 {
		t.Errorf("visited %d, want 2", visited)
	}
}

func TestCursor_ReadAll(t *testing.T) {
	cur := cursorFromResult(&Result{
		Columns: []string{"id", "name"},
		Rows:    [][]string{{"1", "a"}, {"2", "b"}},
	})
	rows, err := cur.ReadAll()
	if err != nil {
		t.Fatalf("ReadAll: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("got %d rows", len(rows))
	}
	if id := rows[0]["id"]; id.Kind != KindInt || id.Int != 1 {
		t.Errorf("row0.id = {%v, %d}", id.Kind, id.Int)
	}
}

func TestCursor_TypedRowBeforeNext(t *testing.T) {
	cur := cursorFromResult(&Result{
		Columns: []string{"k"},
		Rows:    [][]string{{"v"}},
	})
	defer cur.Close()
	// Before any Next(), both Row and RowTyped return nil.
	if cur.Row() != nil {
		t.Error("Row before Next != nil")
	}
	if cur.RowTyped() != nil {
		t.Error("RowTyped before Next != nil")
	}
}
