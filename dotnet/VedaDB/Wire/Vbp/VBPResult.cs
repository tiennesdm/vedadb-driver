// VedaDB .NET SDK — VBP wire layer
//
// Result of a VBP query execution. Mirrors the Python/Java POC's VBPResult.

using System.Collections.Generic;

namespace VedaDB.Wire.Vbp
{
    public sealed class VBPResult
    {
        public IReadOnlyList<string> Columns { get; }
        public IReadOnlyList<ushort> ColumnTypes { get; }
        public IReadOnlyList<IReadOnlyList<object?>> Rows { get; }
        public string CommandTag { get; }
        public long RowsAffected { get; }

        public VBPResult(
            IReadOnlyList<string> columns,
            IReadOnlyList<ushort> columnTypes,
            IReadOnlyList<IReadOnlyList<object?>> rows,
            string commandTag,
            long rowsAffected)
        {
            Columns = columns;
            ColumnTypes = columnTypes;
            Rows = rows;
            CommandTag = commandTag;
            RowsAffected = rowsAffected;
        }

        public int RowCount => Rows.Count;
        public IReadOnlyList<object?>? GetRow(int i) => i < 0 || i >= Rows.Count ? null : Rows[i];
        public object? GetValue(int row, int col)
        {
            var r = GetRow(row);
            return r == null || col < 0 || col >= r.Count ? null : r[col];
        }

        public override string ToString() =>
            $"VBPResult(cols={Columns.Count}, rows={Rows.Count}, tag={CommandTag}, affected={RowsAffected})";
    }
}
