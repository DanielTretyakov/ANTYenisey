'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Role } from '@yenisey/types';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { clearSession } from '@/lib/session';
import { useSession } from '@/lib/useSession';

/**
 * Разделы приложения и то, кому они видны.
 *
 * Список общий для всех страниц: раньше ссылки жили в каждой странице по
 * отдельности, и получалось, что состав клуба открывался только из настроек, а
 * из самого состава можно было уйти лишь в кабинет. Один набор ссылок в шапке
 * снимает этот вопрос целиком.
 */
const SECTIONS: { href: string; label: string; roles: Role[] }[] = [
  { href: '/cabinet', label: 'Кабинет', roles: ['CLIENT', 'COACH', 'ADMIN', 'OWNER'] },
  { href: '/people', label: 'Состав клуба', roles: ['ADMIN', 'OWNER'] },
  { href: '/club', label: 'Настройки клуба', roles: ['ADMIN', 'OWNER'] },
];

/**
 * Навигация в шапке.
 *
 * Своя сессия, а не переданная сверху: шапка рисуется на каждой странице, и
 * протаскивать в неё пользователя через все компоненты означало бы менять
 * сигнатуру каждого экрана ради одной строки.
 */
export function MainNav() {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();

  if (session.status !== 'ready') {
    return null;
  }

  const { role } = session.user;
  const sections = SECTIONS.filter((section) => section.roles.includes(role));

  async function handleLogout(): Promise<void> {
    // Токен гасится на сервере, а не только стирается локально: иначе
    // украденная копия осталась бы рабочей все 30 дней после «выхода».
    await api.logout().catch(() => undefined);

    clearSession();
    router.replace('/login');
  }

  return (
    <nav className="flex items-center gap-1 sm:gap-2" aria-label="Разделы">
      {sections.map((section) => {
        const active = pathname === section.href;

        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-control px-3 py-1.5 text-[0.875rem] whitespace-nowrap transition-colors',
              active
                ? 'bg-surface-accent-soft text-text-accent'
                : 'text-text-muted hover:bg-surface-sunken hover:text-text',
            )}
          >
            {section.label}
          </Link>
        );
      })}

      <Button variant="ghost" size="sm" onClick={() => void handleLogout()}>
        Выйти
      </Button>
    </nav>
  );
}
