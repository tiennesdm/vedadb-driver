/**
 * Knowledge Article Detail Page — Stub
 */
import { useParams } from 'react-router-dom';

export default function KnowledgeArticle() {
  const { id } = useParams<{ id: string }>();
  return (
    <div>
      <h2 className="text-xl font-medium text-[#1f1f1f]">Article #{id}</h2>
      <p className="mt-2 text-sm text-[#595959]">Article view coming soon.</p>
    </div>
  );
}
