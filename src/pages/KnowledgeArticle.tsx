/**
 * Knowledge Article Page — Full article view with real API, author info, feedback, and related articles
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Eye,
  Calendar,
  Clock,
  BookOpen,
  ThumbsUp,
  ThumbsDown,
  Pencil,
  Trash2,
  Share2,
  AlertTriangle,
  Monitor,
  Wifi,
  Lock,
  Code,
  FileText,
  CreditCard,
  Loader2,
} from 'lucide-react';
import useAppStore from '@/lib/vedadb-store';
import { vedaQuery, toObjects } from '@/lib/vedadb-api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog';
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
  author_role?: string;
  created_at: string;
  updated_at: string;
}

interface RelatedArticle {
  id: number;
  title: string;
  category: string;
  views: number;
}

/* ------------------------------------------------------------------ */
/*  Category icon/color config                                         */
/* ------------------------------------------------------------------ */

const CATEGORY_ICON: Record<string, { icon: typeof Monitor; color: string }> = {
  Hardware: { icon: Monitor, color: '#1890ff' },
  Software: { icon: Code, color: '#f5222d' },
  Network: { icon: Wifi, color: '#52c41a' },
  Access: { icon: Lock, color: '#722ed1' },
  General: { icon: FileText, color: '#8a8a8a' },
  Billing: { icon: CreditCard, color: '#faad14' },
};

/* ------------------------------------------------------------------ */
/*  Simple markdown parser                                             */
/* ------------------------------------------------------------------ */

function renderMarkdown(content: string): React.ReactNode[] {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let key = 0;
  let inCodeBlock = false;
  let codeContent = '';
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushList = () => {
    if (listItems.length === 0 || !listType) return;
    const Tag = listType === 'ul' ? 'ul' : 'ol';
    elements.push(
      <Tag key={key++} className={`my-3 ml-5 ${listType === 'ul' ? "list-disc marker:text-[#c9a87c]" : "list-decimal"} space-y-1`}>
        {listItems.map((item, i) => (
          <li key={i} className="text-base text-[#1f1f1f] leading-relaxed">{parseInline(item)}</li>
        ))}
      </Tag>
    );
    listItems = [];
    listType = null;
  };

  const flushCodeBlock = () => {
    if (!inCodeBlock) return;
    elements.push(
      <pre key={key++} className="my-4 overflow-x-auto rounded-lg bg-[#1f1f1f] p-4">
        <code className="font-mono text-sm leading-relaxed text-[#f5f5f5]">{codeContent}</code>
      </pre>
    );
    codeContent = '';
    inCodeBlock = false;
  };

  const parseInline = (text: string): React.ReactNode => {
    const boldParts = text.split(/(\*\*[\s\S]*?\*\*)/g);
    const result: React.ReactNode[] = [];
    boldParts.forEach((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        result.push(<strong key={i} className="font-semibold text-[#1f1f1f]">{part.slice(2, -2)}</strong>);
      } else {
        const codeParts = part.split(/(`[^`]+`)/g);
        codeParts.forEach((cp, j) => {
          if (cp.startsWith('`') && cp.endsWith('`')) {
            result.push(
              <code key={`${i}-${j}`} className="rounded bg-[#f5f0e8] px-1.5 py-0.5 font-mono text-sm text-[#1f1f1f]">
                {cp.slice(1, -1)}
              </code>
            );
          } else {
            const linkParts = cp.split(/(\[[^\]]+\]\([^)]+\))/g);
            linkParts.forEach((lp, k) => {
              const linkMatch = lp.match(/\[([^\]]+)\]\(([^)]+)\)/);
              if (linkMatch) {
                result.push(
                  <a
                    key={`${i}-${j}-${k}`}
                    href={linkMatch[2]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#c9a87c] underline-offset-2 hover:underline"
                  >
                    {linkMatch[1]}
                  </a>
                );
              } else {
                result.push(<span key={`${i}-${j}-${k}`}>{lp}</span>);
              }
            });
          }
        });
      }
    });
    return result;
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        flushList();
        inCodeBlock = true;
      } else {
        flushCodeBlock();
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent += (codeContent ? '\n' : '') + line;
      continue;
    }

    if (line.trim() === '') {
      flushList();
      continue;
    }

    if (line.startsWith('# ')) {
      flushList();
      elements.push(
        <h1 key={key++} className="mb-4 mt-6 text-2xl font-semibold text-[#1f1f1f]">
          {parseInline(line.slice(2))}
        </h1>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      flushList();
      elements.push(
        <h2 key={key++} className="mb-3 mt-5 text-xl font-semibold text-[#1f1f1f]">
          {parseInline(line.slice(3))}
        </h2>
      );
      continue;
    }
    if (line.startsWith('### ')) {
      flushList();
      elements.push(
        <h3 key={key++} className="mb-2 mt-4 text-lg font-semibold text-[#1f1f1f]">
          {parseInline(line.slice(4))}
        </h3>
      );
      continue;
    }

    if (line.startsWith('- [') && line.includes('] ')) {
      const itemText = line.slice(line.indexOf('] ') + 2);
      listItems.push(itemText);
      if (!listType) listType = 'ul';
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      listItems.push(line.slice(2));
      if (!listType) listType = 'ul';
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      listItems.push(line.replace(/^\d+\.\s/, ''));
      if (!listType) listType = 'ol';
      continue;
    }

    flushList();
    elements.push(
      <p key={key++} className="mb-4 text-base leading-relaxed text-[#1f1f1f]">
        {parseInline(line)}
      </p>
    );
  }

  flushList();
  if (inCodeBlock) flushCodeBlock();

  return elements;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatViews(n: number): string {
  return n.toLocaleString();
}

function readingTime(content: string): number {
  const words = content.split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function KnowledgeArticle() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fetchArticleById = useAppStore((s) => s.fetchArticleById);
  const deleteArticle = useAppStore((s) => s.deleteArticle);
  const currentUser = useAppStore((s) => s.currentUser);

  const [article, setArticle] = useState<ArticleRecord | null>(null);
  const [related, setRelated] = useState<RelatedArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<'helpful' | 'not_helpful' | null>(null);
  const [shareTooltip, setShareTooltip] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const isAdminOrAgent = currentUser?.role === 'admin' || currentUser?.role === 'agent' || currentUser?.role === 'super_admin';
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';

  /* Fetch article via real API */
  const fetchArticle = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const articleId = Number(id);
      const result = await fetchArticleById(articleId);
      if (result) {
        setArticle(result as unknown as ArticleRecord);

        // Fetch related articles (same category) via real API
        try {
          const relatedResult = await vedaQuery(
            `SELECT id, title, category, views FROM knowledge_articles WHERE category = '${result.category}' AND id != ${articleId} ORDER BY views DESC LIMIT 4`
          );
          setRelated(toObjects(relatedResult) as unknown as RelatedArticle[]);
        } catch {
          setRelated([]);
        }
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }, [id, fetchArticleById]);

  useEffect(() => {
    setFeedback(null);
    fetchArticle();
  }, [fetchArticle]);

  /* Handlers */
  const handleShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setShareTooltip(true);
      setTimeout(() => setShareTooltip(false), 2000);
    } catch {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setShareTooltip(true);
      setTimeout(() => setShareTooltip(false), 2000);
    }
  };

  const handleDelete = async () => {
    if (!article) return;
    await deleteArticle(article.id);
    setDeleteDialogOpen(false);
    navigate('/knowledge');
  };

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 size={28} className="animate-spin text-[#c9a87c]" />
      </div>
    );
  }

  if (!article) {
    return (
      <EmptyState
        illustration="./empty-knowledge.svg"
        title="Article not found"
        description="The article you're looking for doesn't exist or has been removed."
        action={
          <Button
            onClick={() => navigate('/knowledge')}
            className="h-9 gap-1.5 rounded-lg bg-[#c9a87c] px-4 text-sm font-medium text-[#1f1f1f] hover:bg-[#b8996f]"
          >
            <ArrowLeft size={16} />
            Back to Knowledge Base
          </Button>
        }
      />
    );
  }

  const catConfig = CATEGORY_ICON[article.category] || { icon: FileText, color: '#c9a87c' };
  const CatIcon = catConfig.icon;
  const tags = article.tags ? article.tags.split(',').filter(Boolean) : [];
  const readTime = readingTime(article.content);

  return (
    <div>
      {/* Top Bar Actions */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          onClick={() => navigate('/knowledge')}
          className="h-9 gap-1.5 text-sm text-[#595959] hover:bg-[#f5f0e8] hover:text-[#1f1f1f]"
        >
          <ArrowLeft size={16} />
          Back to Knowledge Base
        </Button>

        <div className="flex items-center gap-2">
          {/* Share */}
          <div className="relative">
            <Button
              variant="ghost"
              onClick={handleShare}
              className="h-9 gap-1.5 text-sm text-[#595959] hover:bg-[#f5f0e8] hover:text-[#1f1f1f]"
            >
              <Share2 size={16} />
              Share
            </Button>
            {shareTooltip && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#1f1f1f] px-2 py-1 text-xs text-white"
              >
                Link copied!
              </motion.div>
            )}
          </div>

          {isAdminOrAgent && (
            <Button
              variant="outline"
              onClick={() => navigate(`/knowledge?edit=${article.id}`)}
              className="h-9 gap-1.5 rounded-lg border-[#e5e0d5] text-sm text-[#595959] hover:bg-[#f5f0e8]"
            >
              <Pencil size={16} />
              Edit
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="ghost"
              onClick={() => setDeleteDialogOpen(true)}
              className="h-9 gap-1.5 text-sm text-[#f5222d] hover:bg-[#fff1f0]"
            >
              <Trash2 size={16} />
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Main Layout */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Article Content (2/3) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
          className="lg:col-span-2"
        >
          {/* Category Badge */}
          <button
            onClick={() => navigate('/knowledge')}
            className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors"
            style={{
              color: catConfig.color,
              backgroundColor: `${catConfig.color}15`,
            }}
          >
            <CatIcon size={14} />
            {article.category}
          </button>

          {/* Title */}
          <h1 className="mt-4 font-[Playfair_Display] text-3xl font-bold leading-tight text-[#1f1f1f] md:text-4xl">
            {article.title}
          </h1>

          {/* Author */}
          <div className="mt-4 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(201,168,124,0.2)] text-xs font-bold text-[#c9a87c]">
              {getInitials(article.author_name || 'A')}
            </div>
            <div>
              <p className="text-sm font-medium text-[#1f1f1f]">{article.author_name || 'Unknown'}</p>
              <p className="text-xs capitalize text-[#8a8a8a]">{article.author_role || 'Agent'}</p>
            </div>
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => navigate('/knowledge')}
                  className="rounded bg-[#f5f0e8] px-2 py-1 text-xs text-[#595959] transition-colors hover:bg-[#ede7db]"
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          {/* Divider */}
          <div className="my-6 border-t border-[#e5e0d5]" />

          {/* Content */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
            className="max-w-[720px]"
          >
            {renderMarkdown(article.content)}
          </motion.div>

          {/* Article Footer */}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-[#e5e0d5] pt-6">
            {/* Feedback */}
            <div className="flex items-center gap-3">
              {!feedback ? (
                <>
                  <span className="text-sm text-[#595959]">Was this article helpful?</span>
                  <Button
                    variant="ghost"
                    onClick={() => setFeedback('helpful')}
                    className="h-10 w-10 p-0 text-[#595959] hover:bg-[#f5f0e8] hover:text-[#52c41a]"
                  >
                    <ThumbsUp size={18} />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setFeedback('not_helpful')}
                    className="h-10 w-10 p-0 text-[#595959] hover:bg-[#f5f0e8] hover:text-[#f5222d]"
                  >
                    <ThumbsDown size={18} />
                  </Button>
                </>
              ) : (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm text-[#52c41a]"
                >
                  Thank you for your feedback!
                </motion.span>
              )}
            </div>

            {/* Last Updated */}
            <span className="text-xs text-[#8a8a8a]">
              Last updated {formatDate(article.updated_at)}
            </span>
          </div>
        </motion.div>

        {/* Sidebar (1/3) */}
        <motion.aside
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.3, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
          className="lg:sticky lg:top-[72px] lg:self-start"
        >
          {/* Author Card */}
          <div className="flex items-center gap-3 rounded-xl bg-[#f5f0e8] p-4">
            {article.author_avatar ? (
              <img
                src={article.author_avatar}
                alt={article.author_name}
                className="h-12 w-12 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(201,168,124,0.2)] text-sm font-bold text-[#c9a87c]">
                {getInitials(article.author_name || 'A')}
              </div>
            )}
            <div>
              <p className="text-xs text-[#8a8a8a]">Written by</p>
              <p className="text-sm font-semibold text-[#1f1f1f]">{article.author_name || 'Unknown'}</p>
              <p className="text-xs capitalize text-[#8a8a8a]">{article.author_role || 'Agent'}</p>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <Eye size={16} className="text-[#8a8a8a]" />
              <span className="text-[#8a8a8a]">Views</span>
              <span className="ml-auto font-medium text-[#1f1f1f]">{formatViews(article.views)}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Calendar size={16} className="text-[#8a8a8a]" />
              <span className="text-[#8a8a8a]">Created</span>
              <span className="ml-auto font-medium text-[#1f1f1f]">{formatDate(article.created_at)}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Clock size={16} className="text-[#8a8a8a]" />
              <span className="text-[#8a8a8a]">Updated</span>
              <span className="ml-auto font-medium text-[#1f1f1f]">{formatDate(article.updated_at)}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <BookOpen size={16} className="text-[#8a8a8a]" />
              <span className="text-[#8a8a8a]">Reading Time</span>
              <span className="ml-auto font-medium text-[#1f1f1f]">{readTime} min</span>
            </div>
          </div>

          {/* Related Articles */}
          {related.length > 0 && (
            <div className="mt-8">
              <h4 className="text-base font-medium text-[#1f1f1f]">Related Articles</h4>
              <div className="mt-3 space-y-3">
                {related.map((rel, i) => {
                  const relCat = CATEGORY_ICON[rel.category] || { icon: FileText, color: '#c9a87c' };
                  return (
                    <motion.div
                      key={rel.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 + i * 0.08, duration: 0.3, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
                      className="cursor-pointer rounded-lg border border-[#e5e0d5] bg-white p-3 transition-all hover:border-[rgba(201,168,124,0.3)] hover:bg-[#fbf9f4]"
                      onClick={() => {
                        navigate(`/knowledge/${rel.id}`);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      <p className="line-clamp-1 text-sm font-semibold text-[#1f1f1f]">{rel.title}</p>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-[11px]" style={{ color: relCat.color }}>
                          {rel.category}
                        </span>
                        <span className="flex items-center gap-1 text-[11px] text-[#8a8a8a]">
                          <Eye size={10} />
                          {formatViews(rel.views)}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions */}
          {isAdminOrAgent && (
            <div className="mt-8 space-y-2">
              <Button
                variant="outline"
                onClick={() => navigate(`/knowledge?edit=${article.id}`)}
                className="w-full gap-1.5 rounded-lg border-[#e5e0d5] text-sm text-[#595959] hover:bg-[#f5f0e8]"
              >
                <Pencil size={16} />
                Edit Article
              </Button>
              {isAdmin && (
                <Button
                  variant="outline"
                  onClick={() => setDeleteDialogOpen(true)}
                  className="w-full gap-1.5 rounded-lg border-[#f5222d] text-sm text-[#f5222d] hover:bg-[#fff1f0]"
                >
                  <Trash2 size={16} />
                  Delete Article
                </Button>
              )}
            </div>
          )}
        </motion.aside>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-[400px] border-[#e5e0d5] bg-white">
          <div className="flex flex-col items-center pt-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#fff1f0]">
              <AlertTriangle size={24} className="text-[#f5222d]" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-[#1f1f1f]">Delete Article</h3>
            <p className="mt-2 text-sm text-[#595959]">
              Are you sure you want to delete <strong className="text-[#1f1f1f]">&quot;{article.title}&quot;</strong>?
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
