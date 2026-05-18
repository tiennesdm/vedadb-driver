/**
 * ThemeColorPicker - Color picker for branding editor
 */
import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Pipette } from 'lucide-react';

interface ThemeColorPickerProps {
  label: string;
  color: string;
  onChange: (color: string) => void;
  description?: string;
}

export default function ThemeColorPicker({ label, color, onChange, description }: ThemeColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const PRESETS = [
    '#c9a87c', '#1a1a1a', '#f5222d', '#faad14', '#52c41a',
    '#1890ff', '#722ed1', '#eb2f96', '#13c2c2', '#fa8c16',
    '#595959', '#8a8a8a', '#e5e0d5', '#fbf9f4', '#ffffff',
  ];

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-[#595959]">{label}</Label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            'relative h-8 w-8 rounded-md border-2 border-[#e5e0d5] shadow-sm transition-all hover:scale-105',
            isOpen && 'ring-2 ring-[#c9a87c] border-[#c9a87c]'
          )}
          style={{ backgroundColor: color }}
        >
          <Pipette className="absolute inset-0 m-auto h-3 w-3 text-white mix-blend-difference" />
        </button>
        <Input
          value={color}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#c9a87c"
          className="h-8 w-24 border-[#e5e0d5] bg-[#fbf9f4] font-mono text-xs"
          maxLength={7}
        />
        <div
          className="h-6 flex-1 rounded-md border border-[#e5e0d5]"
          style={{ backgroundColor: color }}
        />
      </div>
      {description && <p className="text-[10px] text-[#8a8a8a]">{description}</p>}

      {isOpen && (
        <div className="rounded-lg border border-[#e5e0d5] bg-white p-2 shadow-md">
          <div className="mb-2 flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => onChange(e.target.value)}
              className="h-8 w-8 cursor-pointer rounded border-0 p-0"
            />
            <span className="text-[10px] text-[#8a8a8a]">Custom</span>
          </div>
          <div className="grid grid-cols-5 gap-1">
            {PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { onChange(c); }}
                className={cn(
                  'h-6 rounded border transition-all hover:scale-110',
                  color === c ? 'border-[#1a1a1a] ring-1 ring-[#c9a87c]' : 'border-[#e5e0d5]'
                )}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
