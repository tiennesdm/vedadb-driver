/**
 * CustomFieldPanel — Dynamic custom fields per ticket type
 */
import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Settings2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type CustomFieldType = 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'date';

export interface CustomField {
  id: string;
  name: string;
  label: string;
  field_type: CustomFieldType;
  options?: string[];
  required?: boolean;
  value?: string | number | boolean;
  placeholder?: string;
}

interface CustomFieldPanelProps {
  fields: CustomField[];
  onChange?: (fields: CustomField[]) => void;
  editable?: boolean;
  className?: string;
}

export default function CustomFieldPanel({
  fields,
  onChange,
  editable = false,
  className,
}: CustomFieldPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [newField, setNewField] = useState<Partial<CustomField>>({ field_type: 'text' });

  const updateValue = useCallback(
    (id: string, value: string | number | boolean) => {
      const updated = fields.map((f) => (f.id === id ? { ...f, value } : f));
      onChange?.(updated);
    },
    [fields, onChange]
  );

  const removeField = useCallback(
    (id: string) => {
      const updated = fields.filter((f) => f.id !== id);
      onChange?.(updated);
    },
    [fields, onChange]
  );

  const addField = useCallback(() => {
    if (!newField.name || !newField.label) return;
    const field: CustomField = {
      id: `cf_${Date.now()}`,
      name: newField.name,
      label: newField.label,
      field_type: newField.field_type ?? 'text',
      options: newField.options,
      required: newField.required ?? false,
      placeholder: newField.placeholder,
    };
    onChange?.([...fields, field]);
    setNewField({ field_type: 'text' });
    setIsEditing(false);
  }, [newField, fields, onChange]);

  const renderFieldInput = (field: CustomField) => {
    switch (field.field_type) {
      case 'textarea':
        return (
          <Textarea
            value={(field.value as string) ?? ''}
            onChange={(e) => updateValue(field.id, e.target.value)}
            placeholder={field.placeholder}
            className="min-h-[60px] text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c] focus:ring-[#c9a87c]"
          />
        );
      case 'number':
        return (
          <Input
            type="number"
            value={(field.value as number) ?? ''}
            onChange={(e) => updateValue(field.id, Number(e.target.value))}
            placeholder={field.placeholder}
            className="text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c] focus:ring-[#c9a87c]"
          />
        );
      case 'select':
        return (
          <Select
            value={(field.value as string) ?? ''}
            onValueChange={(v) => updateValue(field.id, v)}
          >
            <SelectTrigger className="text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:ring-[#c9a87c]">
              <SelectValue placeholder={field.placeholder ?? 'Select...'} />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'checkbox':
        return (
          <div className="flex items-center gap-2 pt-1">
            <Switch
              checked={!!field.value}
              onCheckedChange={(v) => updateValue(field.id, v)}
            />
            <span className="text-xs text-[#595959]">{field.value ? 'Yes' : 'No'}</span>
          </div>
        );
      case 'date':
        return (
          <Input
            type="date"
            value={(field.value as string) ?? ''}
            onChange={(e) => updateValue(field.id, e.target.value)}
            className="text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c] focus:ring-[#c9a87c]"
          />
        );
      default:
        return (
          <Input
            type="text"
            value={(field.value as string) ?? ''}
            onChange={(e) => updateValue(field.id, e.target.value)}
            placeholder={field.placeholder}
            className="text-sm border-[#e5e0d5] bg-[#fbf9f4] focus:border-[#c9a87c] focus:ring-[#c9a87c]"
          />
        );
    }
  };

  return (
    <div className={cn('rounded-lg border border-[#e5e0d5] bg-white p-4', className)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-[#c9a87c]" />
          <h4 className="text-sm font-semibold text-[#262626]">Custom Fields</h4>
        </div>
        {editable && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-[#c9a87c] hover:text-[#b8996a] hover:bg-[#f5f3ef]"
            onClick={() => setIsEditing(!isEditing)}
          >
            {isEditing ? 'Done' : <><Plus className="h-3 w-3 mr-1" /> Add</>}
          </Button>
        )}
      </div>

      {/* Add new field form */}
      {isEditing && (
        <div className="mb-3 p-3 rounded-md bg-[#fbf9f4] border border-[#e5e0d5] space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-[#595959]">Field Name</Label>
              <Input
                value={newField.name ?? ''}
                onChange={(e) => setNewField((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. asset_tag"
                className="text-xs h-8 border-[#e5e0d5]"
              />
            </div>
            <div>
              <Label className="text-xs text-[#595959]">Label</Label>
              <Input
                value={newField.label ?? ''}
                onChange={(e) => setNewField((p) => ({ ...p, label: e.target.value }))}
                placeholder="e.g. Asset Tag"
                className="text-xs h-8 border-[#e5e0d5]"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-[#595959]">Type</Label>
              <Select
                value={newField.field_type}
                onValueChange={(v: CustomFieldType) => setNewField((p) => ({ ...p, field_type: v }))}
              >
                <SelectTrigger className="text-xs h-8 border-[#e5e0d5]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="textarea">Textarea</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="select">Select</SelectItem>
                  <SelectItem value="checkbox">Checkbox</SelectItem>
                  <SelectItem value="date">Date</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-[#595959]">Options (for select)</Label>
              <Input
                value={newField.options?.join(', ') ?? ''}
                onChange={(e) =>
                  setNewField((p) => ({
                    ...p,
                    options: e.target.value ? e.target.value.split(',').map((s) => s.trim()) : undefined,
                  }))
                }
                placeholder="opt1, opt2, opt3"
                className="text-xs h-8 border-[#e5e0d5]"
              />
            </div>
          </div>
          <Button
            size="sm"
            className="h-7 text-xs bg-[#c9a87c] hover:bg-[#b8996a] text-white"
            onClick={addField}
          >
            Add Field
          </Button>
        </div>
      )}

      {/* Fields */}
      {fields.length === 0 ? (
        <div className="text-center py-4 text-[#8a8a8a] text-xs">No custom fields defined</div>
      ) : (
        <div className="space-y-3">
          {fields.map((field) => (
            <div key={field.id} className="relative">
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs font-medium text-[#262626]">
                  {field.label}
                  {field.required && <span className="text-red-500 ml-0.5">*</span>}
                </Label>
                {editable && (
                  <button
                    onClick={() => removeField(field.id)}
                    className="text-[#8a8a8a] hover:text-red-500 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              {renderFieldInput(field)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
