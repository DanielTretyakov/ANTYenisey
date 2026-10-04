'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { isStaff } from '@yenisey/types';
import { PlatformLogo } from '@/components/brand/PlatformLogo';
import { cn } from '@/lib/cn';
import { OPERATOR, operatorLine, PENDING } from '@/lib/operator';
import { useSession } from '@/lib/useSession';

const YEAR = 2026;

/** Документы платформы — страницы `/legal/[doc]`. */
const DOCUMENTS = [
  { href: '/legal/privacy', label: 'Политика обработки персональных данных' },
  { href: '/legal/consent', label: 'Согласие на обработку данных' },
  { href: '/legal/terms', label: 'Пользовательское соглашение' },
];

/**
 * Подвал платформы — вариант Б (решение владельца от 03.10.2026, аудит):
 * полный на открытых страницах — стартовая, клуб, справка, новости, тренер,
 * игрок, документы, «Подключить клуб»; одной строкой на рабочих — смена,
 * расписание, настройки, кабинет, «Мои записи», вход. Рабочим экранам место
 * нужнее, а документы, помощь и почта доступны с любой страницы.
 */
export function SiteFooter({ variant = 'full', wide = false }: { variant?: 'full' | 'line'; wide?: boolean }) {
  const width = wide ? 'max-w-[112rem]' : 'max-w-6xl';

  if (variant === 'line') {
    return (
      <footer className="border-t border-border bg-surface">
        <div
          className={cn(
            'mx-auto flex w-full flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 text-[0.8125rem] text-text-subtle sm:px-8',
            width,
          )}
        >
          <span>© {YEAR} КНТ</span>
          <FooterLink href="/help">Помощь</FooterLink>
          <FooterLink href="/legal">Документы</FooterLink>
          <FooterLink href="/for-clubs">Подключить клуб</FooterLink>
          <span>{OPERATOR.email ?? `Почта поддержки: ${PENDING}`}</span>
          <DevBadge className="sm:ml-auto" />
        </div>
      </footer>
    );
  }

  return (
    <footer className="mt-20 border-t border-border bg-surface-raised">
      <div className={cn('mx-auto grid w-full gap-10 px-5 pt-12 pb-8 sm:px-8', width)}>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr_1.3fr]">
          <div className="grid content-start gap-3">
            <PlatformLogo height={1.5} />
            <p className="max-w-xs text-[0.875rem] text-text-muted">
              Клубы настольного тенниса в одном месте. Один аккаунт на все клубы.
            </p>
            <DevBadge className="justify-self-start" />
          </div>

          <Column title="Игрокам">
            <FooterLink href="/">Найти клуб</FooterLink>
            <FooterLink href="/my-bookings">Мои записи</FooterLink>
            <FooterLink href="/help/zapis-na-zanyatie">Как записаться</FooterLink>
            <FooterLink href="/help/otmena-zapisi">Отмена и деньги</FooterLink>
          </Column>

          <Column title="Клубам">
            <FooterLink href="/for-clubs">Подключить клуб</FooterLink>
            <FooterLink href="/help/podpiska-knt">Тарифы и подписка</FooterLink>
            <FooterLink href="/help#klubu">Справка для клубов</FooterLink>
            <StaffLinks />
          </Column>

          <Column title="Платформа">
            <FooterLink href="/help">Помощь</FooterLink>
            <FooterLink href="/news">Новости платформы</FooterLink>
            <FooterLink href="/for-clubs#svyaz">Связаться с нами</FooterLink>
          </Column>

          <Column title="Документы">
            {DOCUMENTS.map((document) => (
              <FooterLink key={document.href} href={document.href}>
                {document.label}
              </FooterLink>
            ))}
          </Column>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border pt-5 text-[0.8125rem] text-text-subtle">
          <span>
            © {YEAR} КНТ · {operatorLine()}
          </span>
          <span>{OPERATOR.email ?? `Почта поддержки: ${PENDING}`}</span>
        </div>
      </div>
    </footer>
  );
}

/** Сотруднику — ссылка на рабочее место его первого клуба. */
function StaffLinks() {
  const session = useSession();

  if (session.status !== 'ready') return null;

  const club = session.user.memberships.find((membership) => isStaff(membership.roles));

  return club ? <FooterLink href={`/clubs/${club.slug}/desk`}>Рабочее место</FooterLink> : null;
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-2.5">
      <p className="text-[0.75rem] font-semibold tracking-[0.1em] text-text-subtle uppercase">{title}</p>
      <div className="grid gap-2 text-[0.875rem]">{children}</div>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-text-muted underline-offset-2 hover:text-text hover:underline">
      {children}
    </Link>
  );
}

/** «Сервис в разработке» — пометка переезжает в подвал и остаётся плашкой на стартовой. */
function DevBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-warning-border bg-warning-soft px-2.5 py-0.5 text-[0.75rem] font-medium text-warning',
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      Сервис в разработке
    </span>
  );
}
