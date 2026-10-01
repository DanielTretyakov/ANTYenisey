import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import {
  NEWS_SECTION_LABELS,
  parseMarkup,
  plainText,
  type MarkupSpan,
  type NewsItem,
  type NewsSection,
} from '@yenisey/types';
import { cn } from '@/lib/cn';

/**
 * Части новостей платформы, общие для ленты, стартовой страницы и редактора.
 *
 * Текст новости — простой текст с пометками (решение владельца от 30.09.2026):
 * `**жирный**`, `*курсив*`, `__подчёркнутый__`, строки «- » — список, абзацы
 * через пустую строку. Разбирает их общий `parseMarkup`, а элементы строятся
 * здесь из дерева — HTML из текста не вставляется никогда, и скрипт через
 * новость в страницу не попадёт.
 */

/** «26 сентября 2026» — по часам смотрящего: новость про платформу, а не про зал. */
export function newsDate(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
}

/** Текст новости: абзацы, списки и строчное оформление. */
export function NewsBody({ body, className }: { body: string; className?: string }) {
  return (
    <div className={cn('space-y-3 text-[0.9375rem] leading-relaxed text-text', className)}>
      {parseMarkup(body).map((block, index) =>
        block.kind === 'paragraph' ? (
          <p key={index} className="whitespace-pre-line">
            <Spans spans={block.spans} />
          </p>
        ) : (
          <ul key={index} className="list-disc space-y-1 pl-5 marker:text-text-accent">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Spans spans={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function Spans({ spans }: { spans: MarkupSpan[] }) {
  return (
    <>
      {spans.map((span, index) => {
        let node: ReactNode = span.text;
        if (span.underline) node = <u className="underline-offset-2">{node}</u>;
        if (span.italic) node = <em>{node}</em>;
        if (span.bold) node = <strong className="font-semibold">{node}</strong>;
        return <Fragment key={index}>{node}</Fragment>;
      })}
    </>
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
  // Выдержка — без пометок: звёздочки в строке ленты выглядели бы мусором.
  const flat = plainText(body).replace(/\s+/g, ' ').trim();

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
