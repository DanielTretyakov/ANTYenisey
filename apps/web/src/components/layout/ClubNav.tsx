'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { SectionNavState } from '@/components/club/ClubSectionNav';
import type { PublicTenant, PublicUser, Role } from '@yenisey/types';
import { ClubMark } from '@/components/club/ClubMark';
import { CLUB_BAR_HEIGHT } from '@/components/layout/metrics';
import { NavLink } from '@/components/layout/NavLink';
import { CompactSelect, NavSelect } from '@/components/ui/CompactSelect';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { rolesInClub } from '@/lib/membership';
import { useSession } from '@/lib/useSession';

/**
 * Разделы одного клуба.
 *
 * Отдельно от разделов платформы («Мои записи», «Кабинет») — те у аккаунта
 * одни на все клубы, а эти зависят от роли ИМЕННО в этом клубе. Один и тот же
 * человек бывает клиентом здесь и владельцем в соседнем клубе, поэтому роль
 * спрашивается с указанием клуба, а не «вообще».
 */
const SECTIONS: { path: string; label: string; roles: Role[] }[] = [
  // Бронирует только клиент: бронь ссылается на его карточку, которой у
  // сотрудника нет. Ручная бронь администратором — отдельный сценарий ТЗ.
  { path: '/booking', label: 'Забронировать стол', roles: ['CLIENT'] },
  // У администратора здесь ОДНА ссылка, а не список разделов. Разделы живут в
  // колонке AdminShell: их шесть, они делятся на две группы с разной частотой
  // обращения, и в горизонтальной строке эта разница не выражается никак — а
  // восемь ссылок подряд вдобавок ломают неизменную высоту шапки.
  { path: '/desk', label: 'Рабочее место', roles: ['ADMIN', 'MANAGER', 'OWNER'] },
  // У тренера две ссылки, и обе горизонтальные: отдельной колонки, как у
  // администратора, они не оправдывают. Появятся статистика и спарринг —
  // тогда и колонка.
  { path: '/coach/groups', label: 'Мои группы', roles: ['COACH'] },
  // Та же страница, что у клиента, и то же бронирование — ТЗ описывает
  // спарринг именно так. Подпись другая: тренер берёт стол себе под занятие.
  { path: '/booking', label: 'Стол под спарринг', roles: ['COACH'] },
  { path: '/coach', label: 'Моя карточка', roles: ['COACH'] },
];

/**
 * Начало адреса всех страниц клуба.
 *
 * Одно место на всё приложение: клуб едет участком адреса, и собирать эту
 * строку в каждой ссылке значило бы искать их все при следующей правке схемы
 * маршрутов.
 */
export function clubPath(slug: string, path = ''): string {
  return `/clubs/${slug}${path}`;
}

/**
 * Разделы клуба для этого человека: страница клуба первой, дальше — по ролям.
 * Гость и человек без привязки видят то же, что клиент: записаться может любой
 * пользователь платформы, и прятать от него бронь значило бы закрыть
 * единственный вход в клуб. Ролей несколько (решение от 26.09.2026):
 * администратор-тренер видит и рабочее место, и свои группы.
 */
export function clubSections(user: PublicUser | null, slug: string): { href: string; label: string }[] {
  const own = user ? rolesInClub(user, slug) : [];
  const roles: Role[] = own.length > 0 ? own : ['CLIENT'];

  return [
    { href: clubPath(slug), label: 'Страница клуба' },
    ...SECTIONS.filter((section) => section.roles.some((role) => roles.includes(role))).map((section) => ({
      href: clubPath(slug, section.path),
      label: section.label,
    })),
  ];
}

/**
 * Строка клуба — вторая тонкая полоса шапки на страницах клуба (шапка,
 * вариант А, решение от 03.10.2026). Знак и название клуба и его разделы
 * отдельно от разделов платформы: раньше они стояли в одной строке, и у
 * тренера-руководителя рядом оказывалось восемь ссылок и три значка. На
 * телефоне разделы — выпадающим списком, а не лентой вбок.
 */
export function ClubBar({ slug, page }: { slug: string; page?: SectionNavState }) {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [club, setClub] = useState<Pick<PublicTenant, 'name' | 'accentColor' | 'logoFileId'> | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .tenant(slug)
      .then((tenant) => {
        if (!cancelled) setClub(tenant);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const sections = clubSections(session.status === 'ready' ? session.user : null, slug);
  const current = [...sections].reverse().find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`));

  return (
    <div className={cn('border-t border-border bg-surface/95', CLUB_BAR_HEIGHT)}>
      <div className="mx-auto flex h-full w-full max-w-6xl items-center gap-3 px-5 sm:px-8">
        <Link href={clubPath(slug)} className="flex min-w-0 shrink items-center gap-2.5">
          {club ? <ClubMark club={club} size="sm" className="h-7 w-7" /> : <span className="h-7 w-7 shrink-0 rounded-control bg-border/50" />}
          {/* Рядом с разделами страницы на узком компьютере название не
              помещается — там знака хватает (на телефоне разделов в строке нет). */}
          <span className={cn('truncate text-[0.875rem] font-semibold text-text', page && 'sm:hidden xl:inline')}>
            {club?.name ?? ''}
          </span>
        </Link>

        {session.status !== 'loading' && (
          <>
            <span aria-hidden="true" className="hidden h-5 w-px shrink-0 bg-border sm:block" />
            {page ? (
              // На странице клуба — одна полоса (решение владельца от
              // 11.10.2026): разделы страницы прямо в строке клуба, другие
              // страницы клуба — справа. Раньше под строкой висела вторая,
              // плавающая плашка разделов, и они «склеивались».
              <>
                <nav
                  aria-label="Разделы страницы клуба"
                  className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] sm:flex"
                >
                  {page.items.map((item) => (
                    <PageSection key={item.id} label={item.label} current={page.currentId === item.id} onClick={() => page.go(item.id)} />
                  ))}
                </nav>
                <nav aria-label="Разделы клуба" className="hidden shrink-0 items-center gap-1 sm:flex">
                  {sections
                    .filter((section) => section.href !== clubPath(slug))
                    .map((section) =>
                      section.label === 'Забронировать стол' ? (
                        <Link
                          key={section.href}
                          href={section.href}
                          className="inline-flex h-8 items-center rounded-control bg-accent px-3 text-[0.8125rem] font-medium whitespace-nowrap text-accent-text transition-colors hover:bg-accent-hover"
                        >
                          {section.label}
                        </Link>
                      ) : (
                        <NavLink key={section.href} href={section.href} active={false}>
                          {section.label}
                        </NavLink>
                      ),
                    )}
                </nav>
              </>
            ) : (
              <nav aria-label="Разделы клуба" className="hidden min-w-0 items-center gap-1 sm:flex">
                {sections.map((section) => (
                  <NavLink key={section.href} href={section.href} active={current?.href === section.href}>
                    {section.label}
                  </NavLink>
                ))}
              </nav>
            )}
            {/* На странице клуба — один список на телефоне (решение владельца от
                11.10.2026): разделы этой страницы и другие страницы клуба
                группами. Раньше под ним липла вторая плашка «Раздел». */}
            {page && (
              <CompactSelect
                label="Раздел"
                value={page.currentId ? `#${page.currentId}` : `#${page.items[0]?.id ?? ''}`}
                options={[
                  ...page.items.map((item) => ({ value: `#${item.id}`, label: item.label, group: 'На этой странице' })),
                  ...sections
                    .filter((section) => section.href !== clubPath(slug))
                    .map((section) => ({ value: section.href, label: section.label, group: 'Клуб' })),
                ]}
                onChange={(value) => (value.startsWith('#') ? page.go(value.slice(1)) : router.push(value))}
                className="ml-auto w-[11.5rem] shrink-0 sm:hidden [&_label]:sr-only"
              />
            )}
            {!page && sections.length > 1 && (
              <NavSelect
                label="Раздел"
                current={current?.href ?? sections[0]!.href}
                options={sections}
                className="ml-auto w-[11.5rem] shrink-0 sm:hidden [&_label]:sr-only"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Строка разделов страницы без клуба — стартовая (просьба владельца от
 * 15.10.2026: «как шапка страницы клуба»). Та же полоса той же высоты, те же
 * пункты, что у разделов страницы в `ClubBar`, и тот же список на телефоне;
 * знака клуба нет — страница платформенная.
 */
export function PageBar({ page, label }: { page: SectionNavState; label: string }) {
  return (
    <div className={cn('border-t border-border bg-surface/95', CLUB_BAR_HEIGHT)}>
      <div className="mx-auto flex h-full w-full max-w-6xl items-center gap-3 px-5 sm:px-8">
        <nav aria-label={label} className="-ml-2.5 hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] sm:flex">
          {page.items.map((item) => (
            <PageSection key={item.id} label={item.label} current={page.currentId === item.id} onClick={() => page.go(item.id)} />
          ))}
        </nav>
        <CompactSelect
          label="Раздел"
          value={page.currentId ?? page.items[0]?.id ?? ''}
          options={page.items.map((item) => ({ value: item.id, label: item.label }))}
          onChange={page.go}
          className="w-full sm:hidden"
        />
      </div>
    </div>
  );
}

/**
 * Раздел страницы клуба в строке клуба. Новые новости — числом-кружком:
 * подпись приходит как «Новости · 3 новых» (та же, что в списке на телефоне).
 */
function PageSection({ label, current, onClick }: { label: string; current: boolean; onClick: () => void }) {
  const [name, extra] = label.split(' · ');
  const count = extra ? Number.parseInt(extra, 10) : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? 'true' : undefined}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2.5 text-[0.8125rem] whitespace-nowrap transition-colors',
        current ? 'bg-surface-accent-soft text-text-accent' : 'text-text-muted hover:bg-surface-sunken hover:text-text',
      )}
    >
      {name}
      {count > 0 && (
        <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.625rem] font-semibold text-accent-text">
          {count}
        </span>
      )}
    </button>
  );
}
