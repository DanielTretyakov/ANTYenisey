'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PublicTenant, PublicUser, Role } from '@yenisey/types';
import { ClubMark } from '@/components/club/ClubMark';
import { CLUB_BAR_HEIGHT } from '@/components/layout/metrics';
import { NavLink } from '@/components/layout/NavLink';
import { NavSelect } from '@/components/ui/CompactSelect';
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
export function ClubBar({ slug }: { slug: string }) {
  const session = useSession();
  const pathname = usePathname();
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
          <span className="truncate text-[0.875rem] font-semibold text-text">{club?.name ?? ''}</span>
        </Link>

        {session.status !== 'loading' && (
          <>
            <span aria-hidden="true" className="hidden h-5 w-px shrink-0 bg-border sm:block" />
            <nav aria-label="Разделы клуба" className="hidden min-w-0 items-center gap-1 sm:flex">
              {sections.map((section) => (
                <NavLink key={section.href} href={section.href} active={current?.href === section.href}>
                  {section.label}
                </NavLink>
              ))}
            </nav>
            {sections.length > 1 && (
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
