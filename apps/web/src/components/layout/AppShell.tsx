import type { ReactNode } from 'react';
import { ClubNav } from '@/components/layout/ClubNav';
import { SiteHeader } from '@/components/layout/SiteHeader';

/**
 * Каркас внутренних страниц: шапка и содержимое.
 *
 * Саму шапку рисует SiteHeader — она общая со стартовой страницей и формами
 * входа, и её геометрия задана там одним местом. Здесь остаётся только
 * решить, показывать ли разделы клуба: страницы уровня платформы («Мои
 * записи», кабинет) клуба не имеют вовсе.
 */
export function AppShell({
  children,
  actions,
  /** Клуб, чьи разделы показать в шапке. Не передан — страница платформенная. */
  clubSlug,
}: {
  children: ReactNode;
  actions?: ReactNode;
  clubSlug?: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-sunken">
      <SiteHeader actions={actions} clubNav={clubSlug ? <ClubNav slug={clubSlug} /> : undefined} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8 sm:py-14">{children}</main>
    </div>
  );
}
