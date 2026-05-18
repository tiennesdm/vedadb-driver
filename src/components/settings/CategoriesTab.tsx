import { useState, useEffect, useCallback } from 'react';
import {
  FolderPlus, Pencil, Trash2, GripVertical, Monitor, Wifi, UserCircle,
  Cpu, Code, FileText, Folder, Mail, Phone, Shield, Globe, Wrench,
  X, Lock, HelpCircle, CreditCard,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import useAppStore from '@/lib/vedadb-store';

interface Props {
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

interface Category {
  id: number;
  name: string;
  description: string;
  icon: string;
  color: string;
  ticket_count?: number;
  article_count?: number;
}

const ICON_MAP: Record<string, LucideIcon> = {
  Monitor, Wifi, UserCircle, Cpu, Code, FileText, Folder, Mail, Phone,
  Shield, Globe, Wrench, Lock, HelpCircle, CreditCard,
};

const ICON_OPTIONS = [
  'Monitor', 'Wifi', 'UserCircle', 'Cpu', 'Code', 'FileText',
  'Folder', 'Mail', 'Phone', 'Shield', 'Globe', 'Wrench',
];

const COLOR_OPTIONS = [
  '#1890ff', '#52c41a', '#722ed1', '#faad14', '#f5222d', '#c9a87c', '#8a8a8a', '#1f1f1f',
];

export default function CategoriesTab({ showToast }: Props) {
  const query = useAppStore((s) => s.query);
  const insert = useAppStore((s) => s.insert);
  const update = useAppStore((s) => s.update);
  const deleteFrom = useAppStore((s) => s.deleteFrom);

  const [categories, setCategories] = useState<Category[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formIcon, setFormIcon] = useState('Monitor');
  const [formColor, setFormColor] = useState(COLOR_OPTIONS[0]);

  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const loadCategories = useCallback(async () => {
    try {
      const result = await query(`
        SELECT c.*,
          (SELECT COUNT(*) FROM knowledge_articles WHERE category = c.name) as article_count,
          (SELECT COUNT(*) FROM tickets WHERE category = c.name) as ticket_count
        FROM categories c
        ORDER BY c.id
      `);
      setCategories(result.toObjects() as unknown as Category[]);
    } catch {
      showToast('Failed to load categories', 'error');
    }
  }, [query, showToast]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const openAdd = () => {
    setEditingCategory(null);
    setFormName('');
    setFormDescription('');
    setFormIcon('Monitor');
    setFormColor(COLOR_OPTIONS[0]);
    setShowModal(true);
  };

  const openEdit = (cat: Category) => {
    setEditingCategory(cat);
    setFormName(cat.name);
    setFormDescription(cat.description || '');
    setFormIcon(cat.icon || 'Monitor');
    setFormColor(cat.color || COLOR_OPTIONS[0]);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (formName.trim().length < 2) {
      showToast('Category name must be at least 2 characters', 'error');
      return;
    }
    if (formName.trim().length > 50) {
      showToast('Category name must be at most 50 characters', 'error');
      return;
    }
    try {
      if (editingCategory) {
        await update('categories', {
          name: formName.trim(),
          description: formDescription.trim(),
          icon: formIcon,
          color: formColor,
        }, { id: editingCategory.id });
        showToast('Category updated', 'success');
      } else {
        await insert('categories', {
          name: formName.trim(),
          description: formDescription.trim(),
          icon: formIcon,
          color: formColor,
        });
        showToast('Category created', 'success');
      }
      setShowModal(false);
      loadCategories();
    } catch {
      showToast('Failed to save category', 'error');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteFrom('categories', { id });
      setShowDeleteConfirm(null);
      showToast('Category deleted', 'success');
      loadCategories();
    } catch {
      showToast('Failed to delete category', 'error');
    }
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const newCategories = [...categories];
    const [moved] = newCategories.splice(dragIndex, 1);
    newCategories.splice(dropIndex, 0, moved);
    setCategories(newCategories);
    setDragIndex(null);
    setDragOverIndex(null);
    // Save order to localStorage for persistence
    localStorage.setItem('vedadesk_category_order', JSON.stringify(newCategories.map((c) => c.id)));
    showToast('Category order updated', 'success');
  };

  const getIcon = (iconName: string) => {
    const Icon = ICON_MAP[iconName] || Folder;
    return Icon;
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-medium text-[#1f1f1f] tracking-tight">Ticket Categories</h2>
          <p className="mt-1 text-sm text-[#595959]">
            Manage categories for organizing tickets and knowledge articles.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 rounded-lg bg-[#c9a87c] px-4 py-2.5 text-sm font-medium text-[#1f1f1f] transition-all hover:brightness-95 active:scale-[0.98]"
        >
          <FolderPlus size={16} />
          <span className="hidden sm:inline">Add Category</span>
        </button>
      </div>

      {/* Category List */}
      <div className="mt-6 space-y-2">
        {categories.map((cat, index) => {
          const Icon = getIcon(cat.icon);
          const iconColor = cat.color || '#c9a87c';
          return (
            <div
              key={cat.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              className={cn(
                'flex items-center gap-3 rounded-lg border border-[#e5e0d5] bg-white px-4 py-3 transition-all',
                dragOverIndex === index && 'border-[#c9a87c] ring-1 ring-[#c9a87c]/30',
                'hover:shadow-sm'
              )}
            >
              <button
                className="text-[#c9a87c] cursor-grab active:cursor-grabbing shrink-0"
                title="Drag to reorder"
              >
                <GripVertical size={18} />
              </button>

              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: `${iconColor}20` }}
              >
                <Icon size={16} style={{ color: iconColor }} />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#1f1f1f] truncate">{cat.name}</p>
                {cat.description && (
                  <p className="text-xs text-[#8a8a8a] truncate">{cat.description}</p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="rounded-full bg-[#f5f0e8] px-2.5 py-0.5 text-[11px] text-[#595959]">
                  {cat.article_count ?? 0} articles
                </span>
                <span className="rounded-full bg-[#e6f0ff] px-2.5 py-0.5 text-[11px] text-[#595959]">
                  {cat.ticket_count ?? 0} tickets
                </span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => openEdit(cat)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[#595959] transition-colors hover:bg-[#f5f0e8] hover:text-[#1f1f1f]"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(cat.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[#595959] transition-colors hover:bg-[#fff1f0] hover:text-[#f5222d]"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}

        {categories.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#e5e0d5] py-12">
            <Folder size={40} className="text-[#e5e0d5]" />
            <p className="mt-3 text-sm text-[#8a8a8a]">No categories yet</p>
            <button
              onClick={openAdd}
              className="mt-2 text-sm text-[#c9a87c] hover:underline"
            >
              Add your first category
            </button>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div
            className="relative z-50 w-full max-w-[480px] rounded-2xl border border-[#e5e0d5] bg-white p-6 shadow-xl mx-4"
            style={{ animation: 'zoomIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)' }}
          >
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-4 right-4 text-[#8a8a8a] hover:text-[#1f1f1f] transition-colors"
            >
              <X size={18} />
            </button>

            <h3 className="text-lg font-semibold text-[#1f1f1f]">
              {editingCategory ? 'Edit Category' : 'Add Category'}
            </h3>

            <div className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">
                  Category Name *
                </Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. IT Support"
                  className="h-10 border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">
                  Description
                </Label>
                <Textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Brief description of this category"
                  rows={2}
                  className="border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)] resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">
                  Icon
                </Label>
                <div className="flex flex-wrap gap-2">
                  {ICON_OPTIONS.map((icon) => {
                    const IconComp = ICON_MAP[icon];
                    return (
                      <button
                        key={icon}
                        onClick={() => setFormIcon(icon)}
                        className={cn(
                          'flex h-10 w-10 items-center justify-center rounded-lg border transition-all',
                          formIcon === icon
                            ? 'border-[#c9a87c] bg-[rgba(201,168,124,0.1)] text-[#c9a87c]'
                            : 'border-[#e5e0d5] bg-white text-[#8a8a8a] hover:border-[#c9a87c]/50'
                        )}
                        title={icon}
                      >
                        <IconComp size={18} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-[#595959] font-normal">
                  Color
                </Label>
                <div className="flex flex-wrap gap-2">
                  {COLOR_OPTIONS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setFormColor(color)}
                      className={cn(
                        'h-8 w-8 rounded-full border-2 transition-all',
                        formColor === color ? 'border-[#1f1f1f] scale-110' : 'border-transparent hover:scale-105'
                      )}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-[#e5e0d5] px-4 py-2 text-sm font-medium text-[#595959] transition-all hover:bg-[#f5f0e8]"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="rounded-lg bg-[#c9a87c] px-4 py-2 text-sm font-medium text-[#1f1f1f] transition-all hover:brightness-95 active:scale-[0.98]"
              >
                {editingCategory ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(null)} />
          <div className="relative z-50 w-full max-w-[400px] rounded-2xl border border-[#e5e0d5] bg-white p-6 shadow-xl mx-4">
            <h3 className="text-lg font-semibold text-[#1f1f1f]">Delete Category?</h3>
            <p className="mt-2 text-sm text-[#595959]">
              This action cannot be undone. Tickets in this category will need to be reassigned.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="rounded-lg border border-[#e5e0d5] px-4 py-2 text-sm font-medium text-[#595959] transition-all hover:bg-[#f5f0e8]"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(showDeleteConfirm)}
                className="rounded-lg bg-[#f5222d] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#d91f29] active:scale-[0.98]"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
