import type { ClubPost } from '@yenisey/types';
import { newsDate } from '@/components/news/NewsParts';

/**
 * Строка над заголовком публикации клуба: закреп, «Новое», дата и автор.
 * Одна на колонку новостей, ленту и страницу публикации.
 */
export function PostMeta({ post, withAuthor = false }: { post: ClubPost; withAuthor?: boolean }) {
  return (
    <p className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-text-subtle">
      {post.welcome && (
        <span className="inline-flex items-center gap-1 font-medium text-text-accent">
          <PinIcon />
          Закреплено
        </span>
      )}
      {post.unread && (
        <span className="inline-flex items-center gap-1.5 font-medium text-text-accent">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
          Новое
        </span>
      )}
      {!post.welcome && post.publishedAt && <time dateTime={post.publishedAt}>{newsDate(post.publishedAt)}</time>}
      {withAuthor && !post.welcome && <span>· {post.author}</span>}
    </p>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M6 2h4l-.5 4 2.5 2v1.5H4V8l2.5-2L6 2Z" strokeLinejoin="round" />
      <path d="M8 9.5V14" strokeLinecap="round" />
    </svg>
  );
}
