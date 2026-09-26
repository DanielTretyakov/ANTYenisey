import Link from 'next/link';
import { NEWS_SECTION_LABELS, type NewsItem, type NewsSection } from '@yenisey/types';
import { cn } from '@/lib/cn';

/**
 * Части новостей платформы, общие для ленты, стартовой страницы и редактора.
 *
 * Текст новости — простой: абзацы через пустую строку, перенос строки внутри
 * абзаца сохраняется. Разметки (Markdown, HTML) нет намеренно — текст
 * выводится как текст, и вставить в страницу скрипт через новость нельзя.
 */

/** «26 сентября 2026» — по часам смотрящего: новость про платформу, а не про зал. */
export function newsDate(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
}

/** Абзацы текста. */
export function NewsBody({ body, className }: { body: string; className?: string }) {
  const paragraphs = body.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);

  return (
    <div className={cn('space-y-3 text-[0.9375rem] leading-relaxed text-text', className)}>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-line">
          {paragraph}
        </p>
      ))}
    </div>
  );
}

const SECTION_TONE: Record<NewsSection, string> = {
  GENERAL: 'border border-border text-text-muted',
  UPDATES: 'bg-surface-accent-soft text-text-accent',
  CLUBS: 'bg-warning-soft text-warning',
};

export function SectionBadge({ section }: { section: NewsSection }) {
  return (
    <span
      className={cn(
        'inline-flex self-start rounded-full px-2.5 py-0.5 text-[0.75rem] font-medium tracking-[0.02em]',
        SECTION_TONE[section],
      )}
    >
      {NEWS_SECTION_LABELS[section]}
    </span>
  );
}

/** Первые строки текста — для ленты. */
export function excerpt(body: string, limit = 220): string {
  const flat = body.replace(/\s+/g, ' ').trim();

  return flat.length <= limit ? flat : `${flat.slice(0, limit).replace(/\s+\S*$/, '')}…`;
}

/** Строка ленты: раздел, дата, заголовок-ссылка и начало текста. */
export function NewsRow({ item, compact = false }: { item: NewsItem; compact?: boolean }) {
  return (
    <li className="border-b border-border py-5">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <SectionBadge section={item.section} />
        {item.publishedAt && (
          <time dateTime={item.publishedAt} className="text-[0.8125rem] text-text-subtle">
            {newsDate(item.publishedAt)}
          </time>
        )}
      </div>
      <Link href={`/news/${item.id}`} className="group block">
        <h3 className="text-[1.0625rem] font-semibold text-text group-hover:text-text-accent">{item.title}</h3>
        {!compact && <p className="mt-1 text-[0.9375rem] text-text-muted">{excerpt(item.body)}</p>}
      </Link>
    </li>
  );
}
