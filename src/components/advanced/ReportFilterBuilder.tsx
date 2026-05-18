/**
 * ReportFilterBuilder - Filter condition builder for reports
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Trash2, Plus } from 'lucide-react';

export interface FilterCondition {
  id: string;
  field: string;
  operator: string;
  value: string;
}

interface ReportFilterBuilderProps {
  filters: FilterCondition[];
  availableFields: { value: string; label: string }[];
  onChange: (filters: FilterCondition[]) => void;
}

const OPERATORS = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'contains', label: 'Contains' },
  { value: 'starts', label: 'Starts with' },
  { value: 'ends', label: 'Ends with' },
  { value: 'isnull', label: 'Is Empty' },
  { value: 'notnull', label: 'Is Not Empty' },
];

export default function ReportFilterBuilder({
  filters,
  availableFields,
  onChange,
}: ReportFilterBuilderProps) {
  const addFilter = () => {
    onChange([
      ...filters,
      {
        id: `filter_${Date.now()}`,
        field: availableFields[0]?.value || '',
        operator: 'eq',
        value: '',
      },
    ]);
  };

  const updateFilter = (id: string, updates: Partial<FilterCondition>) => {
    onChange(filters.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  };

  const removeFilter = (id: string) => {
    onChange(filters.filter((f) => f.id !== id));
  };

  return (
    <div className="space-y-2">
      {filters.map((filter) => (
        <div key={filter.id} className="flex items-center gap-2">
          <Select
            value={filter.field}
            onValueChange={(v) => updateFilter(filter.id, { field: v })}
          >
            <SelectTrigger className="h-8 text-xs w-[140px] border-[#e5e0d5] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableFields.map((f) => (
                <SelectItem key={f.value} value={f.value} className="text-xs">
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filter.operator}
            onValueChange={(v) => updateFilter(filter.id, { operator: v })}
          >
            <SelectTrigger className="h-8 text-xs w-[110px] border-[#e5e0d5] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATORS.map((op) => (
                <SelectItem key={op.value} value={op.value} className="text-xs">
                  {op.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {!['isnull', 'notnull'].includes(filter.operator) && (
            <Input
              value={filter.value}
              onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
              placeholder="Value"
              className="h-8 text-xs flex-1 border-[#e5e0d5] bg-white"
            />
          )}
          {['isnull', 'notnull'].includes(filter.operator) && (
            <div className="flex-1" />
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-[#c5c0b5] hover:text-red-500"
            onClick={() => removeFilter(filter.id)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        onClick={addFilter}
        className="h-7 text-xs border-[#e5e0d5] text-[#595959] hover:bg-[#f5f2eb]"
      >
        <Plus className="w-3 h-3 mr-1" />
        Add Filter
      </Button>
    </div>
  );
}
