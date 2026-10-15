'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { pageHelpSlugs, quickHelpHidden } from '@/lib/pageHelp';
import { plural } from '@/lib/plural';
import { useDisclosure } from '@/lib/useDisclosure';

/** Статья справки без текста — заголовок и выдержка для списка. */
export interface QuickHelpArticle {
  slug: string;
  title: string;
  summary: string;
}

/**
 * Быстрая помощь (решение владельца от 15.10.2026): круглая кнопка «?» в
 * правом нижнем углу каждой страницы, по нажатию — окно в стиле «С чего
 * начать» со статьями справки, которые касаются ИМЕННО этой страницы
 * (`pageHelpSlugs`). Вся справка — ссылкой внизу окна.
 *
 * Статьи приходят из корневого layout заголовками и выдержками: тексты
 * статей — разметка, и тянуть их в браузер ради списка незачем.
 *
 * Слой — z-[32]: над панелью «Сохранить» расписания (z-[31]), её правый край
 * пуст; под шапкой (z-[35]) и окнами (z-40).
 */
export function QuickHelp({ articles }: { articles: QuickHelpArticle[] }) {
  const pathname = usePathname();
  const panel = useDisclosure();

  if (quickHelpHidden(pathname)) {
    return null;
  }

  const list = pageHelpSlugs(pathname)
    .map((slug) => articles.find((article) => article.slug === slug))
    .filter((article): article is QuickHelpArticle => article !== undefined);

  return (
    <div ref={panel.root} className="fixed right-4 bottom-4 z-[32] sm:right-6 sm:bottom-6">
      <section
        id={panel.panelId}
        aria-labelledby="quick-help"
        hidden={!panel.open}
        className="absolute right-0 bottom-full mb-3 flex max-h-[calc(100dvh-7rem)] w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-card border border-border bg-surface-raised shadow-lg"
      >
        <header className="border-b border-border bg-surface-accent-soft px-5 pt-4 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[0.6875rem] font-semibold tracking-[0.1em] text-text-accent uppercase">Быстрая помощь</p>
              <h2 id="quick-help" className="mt-1 font-display text-[1.0625rem] leading-snug text-text">
                Об этой странице
              </h2>
            </div>
            <button
              type="button"
              onClick={panel.close}
              aria-label="Свернуть"
              className="-mt-1 -mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-subtle hover:bg-surface-sunken hover:text-text"
            >
              <svg
                viewBox="0 0 12 12"
                aria-hidden="true"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
              >
                <path d="M2.5 4.5 6 8l3.5-3.5" />
              </svg>
            </button>
          </div>
        </header>

        <ul className="grid gap-1 overflow-y-auto p-2">
          {list.map((article) => (
            <li key={article.slug}>
              <Link
                href={`/help/${article.slug}`}
                onClick={panel.close}
                className="group flex items-center gap-3 rounded-control px-3 py-2.5 hover:bg-surface-sunken"
              >
                <span className="min-w-0 grow">
                  <span className="block text-[0.9375rem] leading-snug font-medium text-text">{article.title}</span>
                  <span className="mt-0.5 block text-[0.8125rem] leading-snug text-text-subtle">{article.summary}</span>
                </span>
                <span
                  aria-hidden="true"
                  className="text-text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-text-accent"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-[0.8125rem]">
          <Link href="/help" onClick={panel.close} className="font-medium text-text-accent underline-offset-2 hover:underline">
            Вся справка
          </Link>
          <span className="text-text-subtle">
            {list.length} {plural(list.length, 'статья', 'статьи', 'статей')}
          </span>
        </footer>
      </section>

      <button
        type="button"
        onClick={panel.toggle}
        {...panel.buttonProps}
        aria-label="Быстрая помощь по этой странице"
        title="Быстрая помощь"
        className={cn(
          'grid h-12 w-12 place-items-center rounded-full border border-border bg-surface-raised font-display text-[1.25rem] text-text-accent shadow-lg',
          'transition-colors hover:border-border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          panel.open && 'border-border-accent bg-surface-accent-soft',
        )}
      >
        ?
      </button>
    </div>
  );
}
