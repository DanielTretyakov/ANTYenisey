'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { HELP_ARTICLES, HELP_AUDIENCES, helpHref, type HelpArticle, type HelpAudience } from '@/content/help';
import { CompactSelect } from '@/components/ui/CompactSelect';
import { SearchIcon } from '@/components/ui/SearchIcon';
import { Tab } from '@/components/ui/Tab';
import { cn } from '@/lib/cn';
import { searchHelp } from '@/lib/helpSearch';

/** Якорь вкладки в адресе: ссылка «справка для клуба» открывает свою вкладку. */
const ANCHORS: Record<HelpAudience, string> = {
  players: 'igrokam',
  parents: 'roditelyam',
  coaches: 'treneram',
  clubs: 'klubu',
};

/**
 * Оглавление справки: вкладки по ролям и поиск по всем статьям сразу. Пока
 * в поиске пусто — статьи выбранной вкладки; с запросом — найденное во всех.
 */
export function HelpIndex() {
  const [audience, setAudience] = useState<HelpAudience>('players');
  const [query, setQuery] = useState('');

  // Вкладка — из якоря адреса; читается в эффекте, без useSearchParams. И при
  // смене якоря: «Справка для клубов» из подвала ведёт на `/help#klubu` и с
  // самой справки, а страница при этом не перезагружается.
  useEffect(() => {
    const read = (): void => {
      const hash = window.location.hash.slice(1);
      const found = (Object.keys(ANCHORS) as HelpAudience[]).find((key) => ANCHORS[key] === hash);
      if (found) setAudience(found);
    };

    read();
    window.addEventListener('hashchange', read);

    return () => window.removeEventListener('hashchange', read);
  }, []);

  function choose(next: HelpAudience): void {
    setAudience(next);
    window.history.replaceState(null, '', `#${ANCHORS[next]}`);
  }

  const searching = query.trim().length > 0;
  const shown = searching ? searchHelp(HELP_ARTICLES, query) : HELP_ARTICLES.filter((item) => item.audience === audience);
  const lead = HELP_AUDIENCES.find((item) => item.id === audience)?.lead;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="max-w-3xl">
        <h1 className="font-display text-[2rem] leading-tight sm:text-[2.5rem]">Как пользоваться КНТ</h1>
        <p className="mt-2 text-[1rem] text-text-muted">
          Один аккаунт на все клубы настольного тенниса. Выберите, кто вы, или найдите ответ поиском.
        </p>
      </div>

      <label className="relative block max-w-2xl">
        <span className="sr-only">Поиск по справке</span>
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Например: отменить запись, абонемент, ребёнок"
          className="h-12 w-full rounded-control border border-border bg-surface-raised pr-4 pl-12 text-[1rem] text-text placeholder:text-text-subtle"
        />
      </label>

      {/* На телефоне — список (решение от 03.10.2026). */}
      {!searching && (
        <CompactSelect
          label="Для кого"
          value={audience}
          options={HELP_AUDIENCES.map((item) => ({ value: item.id, label: item.label }))}
          onChange={(id) => {
            const found = HELP_AUDIENCES.find((item) => item.id === id);
            if (found) choose(found.id);
          }}
          className="sm:hidden"
        />
      )}

      {!searching && (
        <div role="tablist" aria-label="Для кого" className="hidden flex-wrap gap-1.5 sm:flex">
          {HELP_AUDIENCES.map((item) => (
            <Tab key={item.id} inTablist active={audience === item.id} onClick={() => choose(item.id)}>
              {item.label}
            </Tab>
          ))}
        </div>
      )}

      {!searching && lead && <p className="-mt-2 text-[0.9375rem] text-text-muted">{lead}</p>}

      {searching && shown.length === 0 && (
        <p className="text-[0.9375rem] text-text-muted">
          Ничего не нашлось. Попробуйте другое слово — например, «бронь» вместо «аренда стола».
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {shown.map((article) => (
          <li key={article.slug}>
            <ArticleCard article={article} withAudience={searching} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ArticleCard({ article, withAudience }: { article: HelpArticle; withAudience: boolean }) {
  const audience = HELP_AUDIENCES.find((item) => item.id === article.audience);

  return (
    <Link
      href={helpHref(article.slug)}
      className={cn(
        'group flex h-full flex-col gap-1 rounded-card border border-border bg-surface-raised px-5 py-4',
        'transition-colors hover:border-border-strong',
      )}
    >
      {withAudience && audience && (
        <span className="text-[0.75rem] font-semibold tracking-[0.1em] text-text-subtle uppercase">{audience.label}</span>
      )}
      <span className="text-[1rem] font-medium text-text group-hover:underline">{article.title}</span>
      <span className="text-[0.875rem] text-text-muted">{article.summary}</span>
    </Link>
  );
}
