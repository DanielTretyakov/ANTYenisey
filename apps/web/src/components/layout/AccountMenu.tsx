'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { hasAnyRole, isStaff, MANAGING_ROLES, type PublicUser } from '@yenisey/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { rolesLabel } from '@/lib/roles';
import { clearSession } from '@/lib/session';
import { ThemeIcon } from '@/components/ThemeToggle';
import { applyTheme, readTheme, type ThemePreference } from '@/lib/theme';
import { useDisclosure } from '@/lib/useDisclosure';

/** «Иванов Пётр Сергеевич» → «ИП». */
function initials(fullName: string): string {
  const [last, first] = fullName.trim().split(/\s+/);
  return `${last?.[0] ?? ''}${first?.[0] ?? ''}`.toUpperCase() || '·';
}

/** «Иванов Пётр Сергеевич» → «Иванов П.». */
function shortName(fullName: string): string {
  const [last, first] = fullName.trim().split(/\s+/);
  return first ? `${last} ${first[0]}.` : (last ?? '');
}

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Светлая тема' },
  { value: 'dark', label: 'Тёмная тема' },
  { value: 'system', label: 'Тема как в системе' },
];

/**
 * Меню аккаунта — шапка, вариант А (решение владельца от 03.10.2026).
 *
 * Кнопка с аватаром и именем отвечает на вопрос «а я вошёл?», которого прежняя
 * шапка не решала. Всё, что не нужно на каждом шаге, — в меню: кабинет, мои
 * клубы со ссылкой на рабочее место (сотрудник попадает на смену откуда
 * угодно, а не только со страницы клуба), тренеры, уведомления, разделы
 * владельца платформы, тема и «Выйти» — последним, отдельно: случайно его
 * больше не нажать.
 *
 * С 15.10.2026 (просьба владельца — сжать): «Рабочее место» — мелкой строкой
 * под названием клуба и ролями, а не колонкой справа; тема — тремя значками в
 * строке «Выйти», а не отдельной строкой словами; строки плотнее.
 */
export function AccountMenu({ user }: { user: PublicUser }) {
  const router = useRouter();
  const menu = useDisclosure();
  const [theme, setTheme] = useState<ThemePreference | null>(null);

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  function chooseTheme(value: ThemePreference): void {
    applyTheme(value);
    setTheme(value);
  }

  async function logout(): Promise<void> {
    // Токен гасится на сервере, а не только стирается локально: иначе
    // украденная копия осталась бы рабочей все 30 дней после «выхода».
    await api.logout().catch(() => undefined);
    clearSession();
    router.replace('/login');
  }

  const name = shortName(user.fullName);
  const role = user.platformOwner
    ? 'владелец платформы'
    : user.memberships.some((membership) => isStaff(membership.roles))
      ? 'сотрудник клуба'
      : 'игрок';

  return (
    <div ref={menu.root} className="relative">
      <button
        type="button"
        onClick={menu.toggle}
        {...menu.buttonProps}
        aria-label={`Меню аккаунта: ${name}`}
        className={cn(
          'flex h-11 items-center gap-2 rounded-full border border-border bg-surface-raised p-1 transition-colors hover:border-border-strong',
          'sm:pr-3',
        )}
      >
        <Avatar>{initials(user.fullName)}</Avatar>
        <span className="hidden max-w-[10rem] truncate text-[0.875rem] text-text sm:block">{name}</span>
        <svg viewBox="0 0 12 12" aria-hidden="true" className="hidden h-3 w-3 text-text-subtle sm:block" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>

      <div
        id={menu.panelId}
        className={cn(
          // Под кнопкой, у правого края: на телефоне почти во всю ширину экрана.
          'absolute top-full right-0 z-40 mt-2 w-[min(22rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-7rem)] overflow-x-hidden overflow-y-auto',
          'rounded-card border border-border bg-surface-raised p-1.5 shadow-lg',
          // Колонка не шире панели: без minmax(0,…) длинное имя или клуб
          // растягивают её по содержимому и панель уезжает вбок.
          menu.open ? 'grid grid-cols-[minmax(0,1fr)]' : 'hidden',
        )}
      >
        <div className="flex items-center gap-3 border-b border-border px-3 pt-1.5 pb-2.5">
          <Avatar>{initials(user.fullName)}</Avatar>
          <span className="min-w-0">
            {/* ФИО целиком, переносом: «кто вошёл» — ради этой строки меню и открывают. */}
            <span className="block text-[0.9375rem] leading-snug font-medium [overflow-wrap:anywhere] text-text">{user.fullName}</span>
            <span className="block text-[0.8125rem] text-text-subtle">{role}</span>
          </span>
        </div>

        <MenuLink href="/cabinet">Кабинет</MenuLink>
        <MenuLink href="/my-bookings">Мой календарь</MenuLink>

        {user.memberships.length > 0 && <Group>Мои клубы</Group>}
        {user.memberships.map((membership) => {
          const roles = isStaff(membership.roles) ? rolesLabel(membership.roles) : null;
          const desk = hasAnyRole(membership.roles, MANAGING_ROLES);

          return (
            // Две ссылки одним пунктом меню: клуб — названием, рабочее место —
            // мелкой строкой под ролями. Вложить одну ссылку в другую нельзя.
            <div key={membership.slug} className="min-w-0 rounded-control px-3 py-1.5 hover:bg-surface-sunken">
              <Link href={`/clubs/${membership.slug}`} className="block truncate text-[0.875rem] text-text">
                {membership.name}
              </Link>
              {roles && <span className="block truncate text-[0.75rem] text-text-subtle">{roles}</span>}
              {desk && (
                <Link
                  href={`/clubs/${membership.slug}/desk`}
                  className="mt-0.5 inline-flex items-center gap-1 text-[0.6875rem] font-medium text-text-accent hover:underline"
                >
                  Рабочее место
                  <span aria-hidden="true">→</span>
                </Link>
              )}
            </div>
          );
        })}

        {user.platformOwner && (
          <>
            <Group>Платформа</Group>
            <MenuLink href="/platform/clubs">Клубы и подписки</MenuLink>
            <MenuLink href="/news/editor">Редактор новостей</MenuLink>
          </>
        )}

        <Group>Ещё</Group>
        <MenuLink href="/cabinet/edit/clubs">Мои тренеры и семья</MenuLink>
        <MenuLink href="/cabinet/edit/notifications">Уведомления</MenuLink>
        <MenuLink href="/help">Помощь</MenuLink>

        {/* Последняя строка: «Выйти» слева, тема значками справа. */}
        <div className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-1.5">
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-control px-3 py-2 text-left text-[0.875rem] text-danger hover:bg-surface-sunken"
          >
            Выйти
          </button>
          <span role="radiogroup" aria-label="Тема" className="inline-flex rounded-full border border-border p-0.5">
            {THEMES.map((item) => (
              <button
                key={item.value}
                type="button"
                role="radio"
                aria-checked={theme === item.value}
                aria-label={item.label}
                title={item.label}
                onClick={() => chooseTheme(item.value)}
                className={cn(
                  'grid h-8 w-8 place-items-center rounded-full transition-colors',
                  theme === item.value ? 'bg-surface-accent-soft text-text-accent' : 'text-text-subtle hover:text-text',
                )}
              >
                <ThemeIcon preference={item.value} className="h-4 w-4" />
              </button>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

function Avatar({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border-accent bg-surface-accent-soft text-[0.75rem] font-semibold text-text-accent"
    >
      {children}
    </span>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <p className="px-3 pt-2.5 pb-0.5 text-[0.6875rem] tracking-[0.1em] text-text-subtle uppercase">{children}</p>;
}

function MenuLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="min-w-0 rounded-control px-3 py-1.5 text-[0.875rem] text-text hover:bg-surface-sunken">
      <span className="block truncate">{children}</span>
    </Link>
  );
}
