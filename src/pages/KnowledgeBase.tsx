/**
 * Knowledge Base Page — Article listing with search, categories, and article CRUD
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  FilePlus,
  LayoutGrid,
  List,
  Eye,
  Calendar,
  MoreVertical,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  Monitor,
  Wifi,
  Lock,
  Cpu,
  Code,
  FileText,
  CreditCard,
  LayoutTemplate,
  ArrowRight,
} from 'lucide-react';
import useAppStore from '@/lib/vedadb-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import EmptyState from '@/components/EmptyState';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ArticleRecord {
  id: number;
  title: string;
  content: string;
  category: string;
  tags: string;
  views: number;
  author_id: number;
  author_name?: string;
  author_avatar?: string;
  created_at: string;
  updated_at: string;
}

interface CategoryCount {
  category: string;
  count: number;
}

/* ------------------------------------------------------------------ */
/*  Category config                                                    */
/* ------------------------------------------------------------------ */

const CATEGORY_ICON: Record<string, { icon: typeof Monitor; color: string }> = {
  Hardware: { icon: Monitor, color: '#1890ff' },
  Software: { icon: Code, color: '#f5222d' },
  Network: { icon: Wifi, color: '#52c41a' },
  Access: { icon: Lock, color: '#722ed1' },
  General: { icon: FileText, color: '#8a8a8a' },
  Billing: { icon: CreditCard, color: '#faad14' },
};

const CATEGORY_BG: Record<string, string> = {
  Hardware: 'bg-[rgba(24,144,255,0.05)]',
  Software: 'bg-[rgba(245,34,45,0.05)]',
  Network: 'bg-[rgba(82,196,26,0.05)]',
  Access: 'bg-[rgba(114,46,209,0.05)]',
  General: 'bg-[rgba(138,138,138,0.05)]',
  Billing: 'bg-[rgba(250,173,20,0.05)]',
};

/* ------------------------------------------------------------------ */
/*  Animation                                                          */
/* ------------------------------------------------------------------ */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function formatViews(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function KnowledgeBase() {
  const navigate = useNavigate();
  const query = useAppStore((s) => s.query);
  const insert = useAppStore((s) => s.insert);
  const update = useAppStore((s) => s.update);
  const deleteFrom = useAppStore((s) => s.deleteFrom);
  const currentUser = useAppStore((s) => s.currentUser);

  const [articles, setArticles] = useState<ArticleRecord[]>([]);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [sortBy, setSortBy] = useState('popular');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [loading, setLoading] = useState(true);

  /* Modal states */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<ArticleRecord | null>(null);
  const [formData, setFormData] = useState({ title: '', content: '', category: '', tags: '' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [tagInput, setTagInput] = useState('');
  const [formTags, setFormTags] = useState<string[]>([]);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingArticle, setDeletingArticle] = useState<ArticleRecord | null>(null);

  const isAdminOrAgent = currentUser?.role === 'admin' || currentUser?.role === 'agent';

  /* Fetch articles with author info */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await query(`
        SELECT a.*, u.name as author_name, u.avatar as author_avatar
        FROM knowledge_articles a
        LEFT JOIN users u ON a.author_id = u.id
        ORDER BY a.views DESC
      `);
      setArticles(result.toObjects() as unknown as ArticleRecord[]);

      // Fetch category counts
      const catResult = await query(`
        SELECT category, COUNT(*) as count
        FROM knowledge_articles
        GROUP BY category
        ORDER BY count DESC
      `);
      setCategories(catResult.toObjects() as unknown as CategoryCount[]);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [query]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* Filtered & sorted articles */
  const filteredArticles = useMemo(() => {
    let list = [...articles];

    if (activeCategory !== 'All') {
      list = list.filter((a) => a.category === activeCategory);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(term) ||
          a.content.toLowerCase().includes(term) ||
          a.tags.toLowerCase().includes(term)
      );
    }

    switch (sortBy) {
      case 'popular':
        list.sort((a, b) => b.views - a.views);
        break;
      case 'newest':
        list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
      case 'oldest':
        list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case 'title_asc':
        list.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'title_desc':
        list.sort((a, b) => b.title.localeCompare(a.title));
        break;
    }

    return list;
  }, [articles, activeCategory, searchTerm, sortBy]);

  /* Highlight search matches in text */
  const highlightText = (text: string, term: string) => {
    if (!term.trim()) return text;
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? (
        <span key={i} className="rounded-sm bg-[rgba(201,168,124,0.2)] px-0.5">{part}</span>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  };

  /* Form helpers */
  const openAddModal = () => {
    setEditingArticle(null);
    setFormData({ title: '', content: '', category: categories[0]?.category || 'General', tags: '' });
    setFormTags([]);
    setTagInput('');
    setFormErrors({});
    setModalOpen(true);
  };

  const openEditModal = (article: ArticleRecord) => {
    setEditingArticle(article);
    setFormData({
      title: article.title,
      content: article.content,
      category: article.category,
      tags: article.tags,
    });
    setFormTags(article.tags ? article.tags.split(',').filter(Boolean) : []);
    setTagInput('');
    setFormErrors({});
    setModalOpen(true);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.title.trim() || formData.title.trim().length < 3) {
      errors.title = 'Title must be at least 3 characters';
    }
    if (!formData.content.trim() || formData.content.trim().length < 10) {
      errors.content = 'Content must be at least 10 characters';
    }
    if (!formData.category) {
      errors.category = 'Select a category';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    const tagsStr = formTags.join(',');
    if (editingArticle) {
      await update('knowledge_articles', {
        title: formData.title.trim(),
        content: formData.content.trim(),
        category: formData.category,
        tags: tagsStr,
        updated_at: new Date().toISOString(),
      }, { id: editingArticle.id });
    } else {
      await insert('knowledge_articles', {
        title: formData.title.trim(),
        content: formData.content.trim(),
        category: formData.category,
        tags: tagsStr,
        author_id: currentUser?.id || 1,
        views: 0,
      });
    }
    setModalOpen(false);
    fetchData();
  };

  const confirmDelete = (article: ArticleRecord) => {
    setDeletingArticle(article);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingArticle) return;
    await deleteFrom('knowledge_articles', { id: deletingArticle.id });
    setDeleteDialogOpen(false);
    setDeletingArticle(null);
    fetchData();
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !formTags.includes(tag) && formTags.length < 10) {
      setFormTags([...formTags, tag]);
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    setFormTags(formTags.filter((t) => t !== tag));
  };

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();

  const totalArticles = articles.length;
  const totalCategories = categories.length;

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-medium text-[#1f1f1f]">Knowledge Base</h2>
          </div>
          <p className="mt-1 text-sm text-[#8a8a8a]">
            {totalArticles} articles across {totalCategories} categories
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a8a]" />
            <Input
              placeholder="Search articles by title, content, or tags..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 w-[300px] rounded-lg border-[#e5e0d5] bg-white pl-9 pr-8 text-sm placeholder:text-[#8a8a8a] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)]"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8a8a8a] hover:text-[#1f1f1f]"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {isAdminOrAgent && (
            <Button
              onClick={openAddModal}
              className="h-9 gap-1.5 rounded-lg bg-[#c9a87c] px-4 text-sm font-medium text-[#1f1f1f] hover:bg-[#b8996f]"
            >
              <FilePlus size={16} />
              New Article
            </Button>
          )}
        </div>
      </div>

      {/* Category Cards */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
        className="mt-6 flex gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-4 lg:grid-cols-5"
      >
        {/* All category */}
        <button
          onClick={() => setActiveCategory('All')}
          className={`flex min-w-[150px] flex-col items-center rounded-xl border p-4 transition-all duration-200 md:min-w-0 ${
            activeCategory === 'All'
              ? 'border-[#c9a87c] bg-[rgba(201,168,124,0.05)] shadow-[0_2px_8px_rgba(201,168,124,0.1)]'
              : 'border-[#e5e0d5] bg-white hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]'
          }`}
        >
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: 'rgba(201,168,124,0.1)' }}
          >
            <LayoutTemplate size={16} style={{ color: '#c9a87c' }} />
          </div>
          <span className="mt-2 text-xs font-semibold text-[#1f1f1f]">All</span>
          <span className="text-[11px] text-[#8a8a8a]">{totalArticles} articles</span>
        </button>

        {categories.map((cat) => {
          const config = CATEGORY_ICON[cat.category] || { icon: FileText, color: '#c9a87c' };
          const Icon = config.icon;
          const isActive = activeCategory === cat.category;
          return (
            <button
              key={cat.category}
              onClick={() => setActiveCategory(cat.category)}
              className={`flex min-w-[150px] flex-col items-center rounded-xl border p-4 transition-all duration-200 md:min-w-0 ${
                isActive
                  ? 'border-[#c9a87c] bg-[rgba(201,168,124,0.05)] shadow-[0_2px_8px_rgba(201,168,124,0.1)]'
                  : 'border-[#e5e0d5] bg-white hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]'
              }`}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: `${config.color}15` }}>
                <Icon size={16} style={{ color: config.color }} />
              </div>
              <span className="mt-2 text-xs font-semibold text-[#1f1f1f]">{cat.category}</span>
              <span className="text-[11px] text-[#8a8a8a]">{cat.count} articles</span>
            </button>
          );
        })}
      </motion.div>

      {/* Controls Bar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e0d5] pb-4">
        <div className="flex items-center gap-3">
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="h-9 w-[150px] rounded-lg border-[#e5e0d5] bg-[#f5f0e8] text-sm focus:ring-[rgba(201,168,124,0.15)]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="popular">Most Popular</SelectItem>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="title_asc">Title A-Z</SelectItem>
              <SelectItem value="title_desc">Title Z-A</SelectItem>
            </SelectContent>
          </Select>

          <span className="text-sm text-[#8a8a8a]">
            {searchTerm ? `${filteredArticles.length} results for "${searchTerm}"` : `${filteredArticles.length} articles`}
          </span>
        </div>

        <div className="flex items-center rounded-lg bg-[#f5f0e8] p-0.5">
          <button
            onClick={() => setViewMode('grid')}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-all ${
              viewMode === 'grid' ? 'bg-[#c9a87c] text-[#1f1f1f]' : 'text-[#8a8a8a] hover:text-[#595959]'
            }`}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-all ${
              viewMode === 'list' ? 'bg-[#c9a87c] text-[#1f1f1f]' : 'text-[#8a8a8a] hover:text-[#595959]'
            }`}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-[#e5e0d5] bg-white p-6">
              <div className="h-4 w-20 rounded bg-[#f5f0e8]" />
              <div className="mt-3 h-5 w-3/4 rounded bg-[#f5f0e8]" />
              <div className="mt-2 h-4 w-full rounded bg-[#f5f0e8]" />
              <div className="mt-2 h-4 w-2/3 rounded bg-[#f5f0e8]" />
            </div>
          ))}
        </div>
      ) : filteredArticles.length === 0 ? (
        <EmptyState
          illustration="./empty-knowledge.svg"
          title="No articles found"
          description={searchTerm || activeCategory !== 'All' ? 'Try adjusting your search or filters' : 'Create your first knowledge article to get started'}
          action={
            isAdminOrAgent ? (
              <Button
                onClick={openAddModal}
                className="h-9 gap-1.5 rounded-lg bg-[#c9a87c] px-4 text-sm font-medium text-[#1f1f1f] hover:bg-[#b8996f]"
              >
                <FilePlus size={16} />
                New Article
              </Button>
            ) : undefined
          }
        />
      ) : (
        <AnimatePresence mode="wait">
          {viewMode === 'grid' ? (
            <motion.div
              key="grid"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              exit={{ opacity: 0 }}
              className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {filteredArticles.map((article) => {
                const catConfig = CATEGORY_ICON[article.category] || { icon: FileText, color: '#c9a87c' };
                const excerpt = article.content.replace(/^#+\s*/gm, '').slice(0, 120);
                const tags = article.tags ? article.tags.split(',').filter(Boolean) : [];
                return (
                  <motion.div
                    key={article.id}
                    variants={cardVariants}
                    className="group cursor-pointer rounded-xl border border-[#e5e0d5] bg-white p-5 transition-all duration-300 hover:-translate-y-1 hover:border-[rgba(201,168,124,0.3)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.08)]"
                    onClick={() => navigate(`/knowledge/${article.id}`)}
                  >
                    {/* Category badge */}
                    <div className="flex items-center justify-between">
                      <span
                        className="rounded px-2 py-0.5 text-[11px] font-medium"
                        style={{
                          color: catConfig.color,
                          backgroundColor: `${catConfig.color}15`,
                        }}
                      >
                        {article.category}
                      </span>
                      {isAdminOrAgent && (
                        <div className="opacity-0 transition-opacity group-hover:opacity-100">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="flex h-7 w-7 items-center justify-center rounded-md text-[#8a8a8a] hover:bg-[#f5f0e8] hover:text-[#1f1f1f]"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreVertical size={16} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEditModal(article); }}>
                                <Pencil size={14} className="mr-2" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); confirmDelete(article); }} className="text-[#f5222d] focus:text-[#f5222d]">
                                <Trash2 size={14} className="mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </div>

                    {/* Title */}
                    <h3 className="mt-2 line-clamp-2 text-base font-medium text-[#1f1f1f]">
                      {searchTerm ? highlightText(article.title, searchTerm) : article.title}
                    </h3>

                    {/* Excerpt */}
                    <p className="mt-1 line-clamp-3 text-sm text-[#595959]">
                      {searchTerm ? highlightText(excerpt, searchTerm) : excerpt}
                    </p>

                    {/* Tags */}
                    {tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="rounded bg-[#f5f0e8] px-1.5 py-0.5 text-[10px] text-[#595959]">
                            {tag}
                          </span>
                        ))}
                        {tags.length > 4 && (
                          <span className="text-[10px] text-[#8a8a8a]">+{tags.length - 4}</span>
                        )}
                      </div>
                    )}

                    {/* Meta row */}
                    <div className="mt-4 flex items-center justify-between border-t border-[#e5e0d5] pt-3">
                      <div className="flex items-center gap-3 text-[11px] text-[#8a8a8a]">
                        <span className="flex items-center gap-1">
                          <Eye size={12} />
                          {formatViews(article.views)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar size={12} />
                          {timeAgo(article.created_at)}
                        </span>
                      </div>

                      {/* Author */}
                      <div className="flex items-center gap-1.5">
                        {article.author_avatar ? (
                          <img src={article.author_avatar} alt={article.author_name} className="h-5 w-5 rounded-full" />
                        ) : (
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(201,168,124,0.15)] text-[9px] font-bold text-[#c9a87c]">
                            {getInitials(article.author_name || 'A')}
                          </div>
                        )}
                        <span className="text-[11px] text-[#8a8a8a]">{article.author_name || 'Unknown'}</span>
                      </div>
                    </div>

                    {/* Read link on hover */}
                    <div className="mt-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      <span className="flex items-center gap-1 text-sm font-medium text-[#c9a87c]">
                        Read Article <ArrowRight size={14} />
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mt-6 overflow-hidden rounded-xl border border-[#e5e0d5] bg-white"
            >
              {/* Table Header */}
              <div className="hidden grid-cols-[1fr_130px_150px_100px_120px_60px] gap-4 border-b border-[#e5e0d5] bg-[#f5f0e8] px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#595959] md:grid">
                <span>Title</span>
                <span>Category</span>
                <span>Author</span>
                <span className="text-center">Views</span>
                <span>Updated</span>
                <span />
              </div>

              {filteredArticles.map((article) => {
                const catConfig = CATEGORY_ICON[article.category] || { icon: FileText, color: '#c9a87c' };
                return (
                  <div
                    key={article.id}
                    className="group grid cursor-pointer grid-cols-1 items-center gap-3 border-b border-[#e5e0d5] px-4 py-3 transition-colors last:border-b-0 hover:bg-[#fbf9f4] md:grid-cols-[1fr_130px_150px_100px_120px_60px] md:gap-4"
                    onClick={() => navigate(`/knowledge/${article.id}`)}
                  >
                    {/* Title + Excerpt */}
                    <div>
                      <p className="text-sm font-semibold text-[#1f1f1f]">
                        {searchTerm ? highlightText(article.title, searchTerm) : article.title}
                      </p>
                      <p className="mt-0.5 line-clamp-1 text-xs text-[#8a8a8a]">
                        {article.content.slice(0, 80)}...
                      </p>
                    </div>

                    {/* Category */}
                    <span
                      className="w-fit rounded px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        color: catConfig.color,
                        backgroundColor: `${catConfig.color}15`,
                      }}
                    >
                      {article.category}
                    </span>

                    {/* Author */}
                    <div className="flex items-center gap-2">
                      {article.author_avatar ? (
                        <img src={article.author_avatar} alt={article.author_name} className="h-6 w-6 rounded-full" />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(201,168,124,0.15)] text-[9px] font-bold text-[#c9a87c]">
                          {getInitials(article.author_name || 'A')}
                        </div>
                      )}
                      <span className="text-sm text-[#1f1f1f]">{article.author_name || 'Unknown'}</span>
                    </div>

                    {/* Views */}
                    <div className="flex items-center justify-center gap-1 text-sm text-[#595959]">
                      <Eye size={14} />
                      {formatViews(article.views)}
                    </div>

                    {/* Updated */}
                    <div className="text-xs text-[#8a8a8a]">
                      {timeAgo(article.updated_at)}
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end">
                      {isAdminOrAgent && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="flex h-7 w-7 items-center justify-center rounded-md text-[#8a8a8a] hover:bg-[#f5f0e8] hover:text-[#1f1f1f]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVertical size={16} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEditModal(article); }}>
                              <Pencil size={14} className="mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); confirmDelete(article); }} className="text-[#f5222d] focus:text-[#f5222d]">
                              <Trash2 size={14} className="mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-[720px] border-[#e5e0d5] bg-white">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-[#1f1f1f]">
              {editingArticle ? 'Edit Article' : 'New Article'}
            </DialogTitle>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {/* Title */}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#595959]">
                Title *
              </label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Enter article title"
                className={`h-10 rounded-lg border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)] ${
                  formErrors.title ? 'border-[#f5222d]' : ''
                }`}
              />
              {formErrors.title && <p className="mt-1 text-xs text-[#f5222d]">{formErrors.title}</p>}
            </div>

            {/* Category */}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#595959]">
                Category *
              </label>
              <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                <SelectTrigger className="h-10 w-full rounded-lg border-[#e5e0d5] focus:ring-[rgba(201,168,124,0.15)]">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.category} value={c.category}>
                      {c.category}
                    </SelectItem>
                  ))}
                  <SelectItem value="General">General</SelectItem>
                </SelectContent>
              </Select>
              {formErrors.category && <p className="mt-1 text-xs text-[#f5222d]">{formErrors.category}</p>}
            </div>

            {/* Tags */}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#595959]">
                Tags ({formTags.length}/10)
              </label>
              <div className="flex flex-wrap gap-1.5 rounded-lg border border-[#e5e0d5] p-2 focus-within:border-[#c9a87c] focus-within:ring-[3px] focus-within:ring-[rgba(201,168,124,0.15)]">
                {formTags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1 rounded-full bg-[#f5f0e8] px-2 py-0.5 text-xs text-[#595959]">
                    {tag}
                    <button onClick={() => removeTag(tag)} className="text-[#8a8a8a] hover:text-[#f5222d]">
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {formTags.length < 10 && (
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="Add tag..."
                    className="min-w-[80px] flex-1 bg-transparent text-sm outline-none placeholder:text-[#8a8a8a]"
                  />
                )}
              </div>
            </div>

            {/* Content */}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#595959]">
                Content *
              </label>
              <Textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder="Write your article content here..."
                rows={8}
                className={`min-h-[200px] rounded-lg border-[#e5e0d5] focus-visible:border-[#c9a87c] focus-visible:ring-[rgba(201,168,124,0.15)] ${
                  formErrors.content ? 'border-[#f5222d]' : ''
                }`}
              />
              <div className="mt-1 flex justify-between">
                {formErrors.content ? (
                  <p className="text-xs text-[#f5222d]">{formErrors.content}</p>
                ) : (
                  <span />
                )}
                <span className="text-xs text-[#8a8a8a]">{formData.content.length} characters</span>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => setModalOpen(false)}
              className="h-9 rounded-lg border-[#e5e0d5] px-4 text-sm text-[#595959] hover:bg-[#f5f0e8]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              className="h-9 rounded-lg bg-[#c9a87c] px-4 text-sm font-medium text-[#1f1f1f] hover:bg-[#b8996f]"
            >
              {editingArticle ? 'Save Changes' : 'Publish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-[400px] border-[#e5e0d5] bg-white">
          <div className="flex flex-col items-center pt-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#fff1f0]">
              <AlertTriangle size={24} className="text-[#f5222d]" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-[#1f1f1f]">Delete Article</h3>
            <p className="mt-2 text-sm text-[#595959]">
              Are you sure you want to delete <strong className="text-[#1f1f1f]">&quot;{deletingArticle?.title}&quot;</strong>?
              This action cannot be undone.
            </p>
          </div>
          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              className="h-9 rounded-lg border-[#e5e0d5] px-4 text-sm text-[#595959] hover:bg-[#f5f0e8]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              className="h-9 rounded-lg bg-[#f5222d] px-4 text-sm font-medium text-white hover:bg-[#cf1322]"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
