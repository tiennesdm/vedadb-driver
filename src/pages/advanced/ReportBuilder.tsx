/**
 * ReportBuilder - Drag-and-drop report builder
 * Route: /report-builder
 */
import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  BarChart3,
  Save,
  Eye,
  FileSpreadsheet,
  FileText,
  Table2,
  BarChart,
  LineChart as LineChartIcon,
  PieChart as PieChartIcon,
  CircleDot,
} from 'lucide-react';
import ChartRenderer from '@/components/advanced/ChartRenderer';
import ReportFilterBuilder from '@/components/advanced/ReportFilterBuilder';
import type { FilterCondition } from '@/components/advanced/ReportFilterBuilder';

/* ------------------------------------------------------------------ */
/*  Data source fields                                                 */
/* ------------------------------------------------------------------ */

const DATA_SOURCES: Record<string, { label: string; fields: { value: string; label: string }[] }> = {
  tickets: {
    label: 'Tickets',
    fields: [
      { value: 'id', label: 'ID' },
      { value: 'title', label: 'Title' },
      { value: 'status', label: 'Status' },
      { value: 'priority', label: 'Priority' },
      { value: 'category', label: 'Category' },
      { value: 'ticket_type', label: 'Type' },
      { value: 'assigned_to', label: 'Assignee' },
      { value: 'department_id', label: 'Department' },
      { value: 'created_at', label: 'Created At' },
      { value: 'updated_at', label: 'Updated At' },
    ],
  },
  users: {
    label: 'Users',
    fields: [
      { value: 'id', label: 'ID' },
      { value: 'name', label: 'Name' },
      { value: 'email', label: 'Email' },
      { value: 'role', label: 'Role' },
      { value: 'department_id', label: 'Department' },
      { value: 'created_at', label: 'Created At' },
    ],
  },
  assets: {
    label: 'Assets',
    fields: [
      { value: 'id', label: 'ID' },
      { value: 'name', label: 'Name' },
      { value: 'type', label: 'Type' },
      { value: 'status', label: 'Status' },
      { value: 'owner_id', label: 'Owner' },
      { value: 'created_at', label: 'Created At' },
    ],
  },
  changes: {
    label: 'Changes',
    fields: [
      { value: 'id', label: 'ID' },
      { value: 'title', label: 'Title' },
      { value: 'status', label: 'Status' },
      { value: 'priority', label: 'Priority' },
      { value: 'requester', label: 'Requester' },
      { value: 'created_at', label: 'Created At' },
    ],
  },
  problems: {
    label: 'Problems',
    fields: [
      { value: 'id', label: 'ID' },
      { value: 'title', label: 'Title' },
      { value: 'status', label: 'Status' },
      { value: 'priority', label: 'Priority' },
      { value: 'root_cause', label: 'Root Cause' },
      { value: 'created_at', label: 'Created At' },
    ],
  },
};

/* ------------------------------------------------------------------ */
/*  Chart type icons                                                   */
/* ------------------------------------------------------------------ */

const CHART_TYPES = [
  { value: 'table', label: 'Table', icon: Table2 },
  { value: 'bar', label: 'Bar', icon: BarChart },
  { value: 'line', label: 'Line', icon: LineChartIcon },
  { value: 'pie', label: 'Pie', icon: PieChartIcon },
  { value: 'donut', label: 'Donut', icon: CircleDot },
];

/* ------------------------------------------------------------------ */
/*  Demo data generator                                                */
/* ------------------------------------------------------------------ */

function generateDemoData(source: string) {
  if (source === 'tickets') {
    return [
      { name: 'Open', value: 12, status: 'open', priority: 'high' },
      { name: 'In Progress', value: 8, status: 'in_progress', priority: 'medium' },
      { name: 'Resolved', value: 24, status: 'resolved', priority: 'low' },
      { name: 'Closed', value: 45, status: 'closed', priority: 'low' },
      { name: 'On Hold', value: 3, status: 'on_hold', priority: 'medium' },
    ];
  }
  if (source === 'users') {
    return [
      { name: 'Admin', value: 2, role: 'admin' },
      { name: 'Manager', value: 5, role: 'manager' },
      { name: 'Agent', value: 18, role: 'agent' },
      { name: 'Customer', value: 120, role: 'customer' },
    ];
  }
  if (source === 'assets') {
    return [
      { name: 'Laptop', value: 45, type: 'hardware' },
      { name: 'Desktop', value: 30, type: 'hardware' },
      { name: 'Server', value: 12, type: 'hardware' },
      { name: 'License', value: 200, type: 'software' },
    ];
  }
  return [
    { name: 'Jan', value: 10 },
    { name: 'Feb', value: 15 },
    { name: 'Mar', value: 12 },
    { name: 'Apr', value: 20 },
    { name: 'May', value: 18 },
  ];
}

/* ------------------------------------------------------------------ */
/*  Saved reports                                                      */
/* ------------------------------------------------------------------ */

interface SavedReport {
  id: string;
  name: string;
  source: string;
  columns: string[];
  filters: FilterCondition[];
  groupBy: string;
  aggregation: string;
  chartType: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ReportBuilder() {
  const [dataSource, setDataSource] = useState('tickets');
  const [selectedColumns, setSelectedColumns] = useState<string[]>(['id', 'title', 'status']);
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [groupBy, setGroupBy] = useState('');
  const [aggregation, setAggregation] = useState('count');
  const [chartType, setChartType] = useState('table');
  const [reportName, setReportName] = useState('');
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);

  const currentFields = DATA_SOURCES[dataSource]?.fields || [];

  const previewData = useMemo(() => {
    return generateDemoData(dataSource);
  }, [dataSource]);

  const toggleColumn = (col: string) => {
    setSelectedColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  const handleSave = () => {
    if (!reportName.trim()) {
      toast.error('Enter report name');
      return;
    }
    if (selectedColumns.length === 0) {
      toast.error('Select at least one column');
      return;
    }
    const report: SavedReport = {
      id: `rpt_${Date.now()}`,
      name: reportName,
      source: dataSource,
      columns: [...selectedColumns],
      filters: [...filters],
      groupBy,
      aggregation,
      chartType,
    };
    setSavedReports([...savedReports, report]);
    toast.success('Report saved');
  };

  const loadReport = (report: SavedReport) => {
    setDataSource(report.source);
    setSelectedColumns(report.columns);
    setFilters(report.filters);
    setGroupBy(report.groupBy);
    setAggregation(report.aggregation);
    setChartType(report.chartType);
    setReportName(report.name);
    toast.success(`Report "${report.name}" loaded`);
  };

  const exportCSV = () => {
    const headers = selectedColumns.join(',');
    const rows = previewData.map((row: Record<string, any>) =>
      selectedColumns.map((col) => row[col] ?? '').join(',')
    );
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reportName || 'report'}.csv`;
    a.click();
    toast.success('CSV exported');
  };

  const exportPDF = () => {
    toast.info('PDF export would generate a PDF document');
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#f5f2eb] flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-[#c9a87c]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#262626]">Report Builder</h1>
            <p className="text-xs text-[#8a8a8a]">Build custom reports with filters and visualizations</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportCSV}
            className="h-8 text-xs border-[#e5e0d5] text-[#595959] hover:bg-[#f5f2eb]"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />
            CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportPDF}
            className="h-8 text-xs border-[#e5e0d5] text-[#595959] hover:bg-[#f5f2eb]"
          >
            <FileText className="w-3.5 h-3.5 mr-1" />
            PDF
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            className="h-8 text-xs bg-[#c9a87c] hover:bg-[#b8986c] text-white"
          >
            <Save className="w-3.5 h-3.5 mr-1" />
            Save
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Configuration panel */}
        <div className="lg:col-span-1 space-y-4">
          <Card className="border border-[#e5e0d5] bg-white">
            <CardHeader className="p-3 pb-0">
              <h3 className="text-xs font-semibold text-[#262626]">Report Name</h3>
            </CardHeader>
            <CardContent className="p-3">
              <Input
                value={reportName}
                onChange={(e) => setReportName(e.target.value)}
                placeholder="My Report"
                className="h-8 text-xs border-[#e5e0d5]"
              />
            </CardContent>
          </Card>

          {/* Data Source */}
          <Card className="border border-[#e5e0d5] bg-white">
            <CardHeader className="p-3 pb-0">
              <h3 className="text-xs font-semibold text-[#262626]">Data Source</h3>
            </CardHeader>
            <CardContent className="p-3">
              <Select value={dataSource} onValueChange={setDataSource}>
                <SelectTrigger className="h-8 text-xs border-[#e5e0d5]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DATA_SOURCES).map(([key, ds]) => (
                    <SelectItem key={key} value={key} className="text-xs">
                      {ds.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Column Picker */}
          <Card className="border border-[#e5e0d5] bg-white">
            <CardHeader className="p-3 pb-0">
              <h3 className="text-xs font-semibold text-[#262626]">Columns</h3>
            </CardHeader>
            <CardContent className="p-3">
              <div className="space-y-1">
                {currentFields.map((field) => (
                  <label
                    key={field.value}
                    className="flex items-center gap-2 cursor-pointer text-xs text-[#595959] hover:text-[#262626]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedColumns.includes(field.value)}
                      onChange={() => toggleColumn(field.value)}
                      className="rounded border-[#e5e0d5] accent-[#c9a87c]"
                    />
                    {field.label}
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Filters */}
          <Card className="border border-[#e5e0d5] bg-white">
            <CardHeader className="p-3 pb-0">
              <h3 className="text-xs font-semibold text-[#262626]">Filters</h3>
            </CardHeader>
            <CardContent className="p-3">
              <ReportFilterBuilder
                filters={filters}
                availableFields={currentFields}
                onChange={setFilters}
              />
            </CardContent>
          </Card>

          {/* Group By */}
          <Card className="border border-[#e5e0d5] bg-white">
            <CardHeader className="p-3 pb-0">
              <h3 className="text-xs font-semibold text-[#262626]">Group By</h3>
            </CardHeader>
            <CardContent className="p-3 space-y-2">
              <Select value={groupBy} onValueChange={setGroupBy}>
                <SelectTrigger className="h-8 text-xs border-[#e5e0d5]">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="" className="text-xs">None</SelectItem>
                  {currentFields.map((f) => (
                    <SelectItem key={f.value} value={f.value} className="text-xs">
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {groupBy && (
                <Select value={aggregation} onValueChange={setAggregation}>
                  <SelectTrigger className="h-8 text-xs border-[#e5e0d5]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="count" className="text-xs">Count</SelectItem>
                    <SelectItem value="sum" className="text-xs">Sum</SelectItem>
                    <SelectItem value="avg" className="text-xs">Average</SelectItem>
                    <SelectItem value="min" className="text-xs">Min</SelectItem>
                    <SelectItem value="max" className="text-xs">Max</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </CardContent>
          </Card>

          {/* Chart Type */}
          <Card className="border border-[#e5e0d5] bg-white">
            <CardHeader className="p-3 pb-0">
              <h3 className="text-xs font-semibold text-[#262626]">Chart Type</h3>
            </CardHeader>
            <CardContent className="p-3">
              <div className="grid grid-cols-5 gap-1">
                {CHART_TYPES.map((ct) => {
                  const Icon = ct.icon;
                  return (
                    <button
                      key={ct.value}
                      className={`flex flex-col items-center gap-1 p-2 rounded-md transition-colors ${
                        chartType === ct.value
                          ? 'bg-[#c9a87c]/10 border border-[#c9a87c]'
                          : 'hover:bg-[#f5f2eb] border border-transparent'
                      }`}
                      onClick={() => setChartType(ct.value)}
                    >
                      <Icon
                        className={`w-4 h-4 ${
                          chartType === ct.value ? 'text-[#c9a87c]' : 'text-[#8a8a8a]'
                        }`}
                      />
                      <span className="text-[9px] text-[#595959]">{ct.label}</span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Saved Reports */}
          {savedReports.length > 0 && (
            <Card className="border border-[#e5e0d5] bg-white">
              <CardHeader className="p-3 pb-0">
                <h3 className="text-xs font-semibold text-[#262626]">Saved Reports</h3>
              </CardHeader>
              <CardContent className="p-3">
                <div className="space-y-1">
                  {savedReports.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between p-2 rounded-md hover:bg-[#f5f2eb] cursor-pointer"
                      onClick={() => loadReport(r)}
                    >
                      <span className="text-xs text-[#262626]">{r.name}</span>
                      <Eye className="w-3 h-3 text-[#8a8a8a]" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Preview */}
        <div className="lg:col-span-2">
          <Card className="border border-[#e5e0d5] bg-white h-full">
            <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[#262626]">Preview</h3>
                <p className="text-[10px] text-[#8a8a8a]">
                  {DATA_SOURCES[dataSource]?.label} - {selectedColumns.length} columns
                  {filters.length > 0 && ` - ${filters.length} filters`}
                  {groupBy && ` - grouped by ${groupBy}`}
                </p>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <ChartRenderer
                type={chartType as 'table' | 'bar' | 'line' | 'pie' | 'donut'}
                data={previewData}
                columns={selectedColumns}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
