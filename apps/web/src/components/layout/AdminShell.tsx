'use client';

import type { Role } from '@yenisey/types';
import { rolesInClub } from '@/lib/membership';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { clubPath } from '@/components/layout/ClubNav';
import { cn } from '@/lib/cn';
import { useClubSlug } from '@/lib/useClubApi';
import { useSession } from '@/lib/useSession';

/**
 * Каркас рабочего места администратора: шапка платформы и колонка разделов.
 *
 * Почему колонка, а не ссылки в шапке. Разделов у администратора пять, и
 * делятся они на две группы с совершенно разной частотой обращения: смену и
 * расписание открывают каждый вечер, настройки — раз в сезон. В одной
 * горизонтальной строке эта разница не выражается никак, а восемь ссылок подряд
 * вдобавок переносятся на вторую строку уже на ноутбуке — и ломают правило
 * `SiteHeader` о неизменной высоте шапки.
 *
 * Клиентские страницы клуба каркас не трогает: они остаются на `AppShell`.
 * Расходятся администратор и клиент намеренно — у них разные задачи.
 */

interface Section {
  /** Хвост адреса после /clubs/:slug. */
  path: string;
  label: string;
  /** Только для этих ролей; пусто — для всех, кто в админке. */
  roles?: Role[];
}

/**
 * Операционка: то, что открывают в течение смены.
 *
 * Расписание стоит здесь, а не в настройках: сетку правят каждый вечер —
 * переносят занятие, закрывают стол под ремонт, — и держать её рядом с ценами,
 * которые меняют раз в сезон, значило гонять администратора через раздел,
 * который ему в смену не нужен.
 *
 * «Брони» появятся здесь своей фазой. Ставить ссылку на ненаписанный раздел
 * нельзя — она ведёт в 404, и хуже отсутствующего пункта меню только пункт,
 * который врёт.
 */
const SHIFT: Section[] = [
  { path: '/desk', label: 'Смена' },
  { path: '/schedule', label: 'Расписание залов' },
  // Кто из администраторов в какой день на смене (решение владельца от
  // 26.09.2026) — назначает управляющий, раздел только руководству.
  { path: '/staff', label: 'Расписание персонала', roles: ['OWNER', 'MANAGER'] },
  // История абонементов — операционка, а не устройство клуба: сюда приходят с
  // вопросом «куда делся визит», и приходят посреди смены.
  { path: '/subscriptions', label: 'Абонементы' },
];

/** Устройство клуба: то, что настраивают редко и осознанно. */
const SETUP: Section[] = [
  { path: '/people', label: 'Состав клуба' },
  { path: '/catalog', label: 'Занятия и турниры' },
  { path: '/settings', label: 'Настройки' },
];

export function AdminShell({
  children,
  actions,
  wide = false,
}: {
  children: ReactNode;
  /** Действия самой страницы — уезжают в шапку, как и на клиентских экранах. */
  actions?: ReactNode;
  /**
   * Широкая страница — для экранов, ширину которых диктуют данные, а не текст.
   *
   * Сейчас такой один — сетка расписания: столов у зала бывает двенадцать, и
   * уместить их в колонку, рассчитанную на читаемый абзац, можно только сжав
   * клетку до нечитаемой. Остальные разделы остаются узкими — им ширина нужна
   * как раз для текста.
   */
  wide?: boolean;
}) {
  // Клуб берётся из адреса, а не пропсом: так же, как во всех клубных
  // страницах, — иначе каждая из них тащила бы его сюда ради одной строки.
  const slug = useClubSlug();
  const session = useSession();

  const clubName =
    session.status === 'ready'
      ? (session.user.memberships.find((membership) => membership.slug === slug)?.name ?? null)
      : null;

  return (
    <div className="flex min-h-dvh flex-col bg-surface-sunken">
      <SiteHeader actions={actions} wide={wide} />

      <div
        className={cn(
          'mx-auto flex w-full flex-1 flex-col gap-0 px-5 sm:px-8 lg:flex-row lg:gap-8',
          wide ? 'max-w-[112rem]' : 'max-w-6xl',
        )}
      >
        <AdminNav slug={slug} clubName={clubName} roles={session.status === 'ready' ? rolesInClub(session.user, slug) : []} />

        <main className="min-w-0 flex-1 py-8 sm:py-10">{children}</main>
      </div>
    </div>
  );
}

/**
 * Разделы рабочего места.
 *
 * На узком экране колонка превращается в горизонтальную полосу с прокруткой, а
 * не в бургер: администратор стоит за стойкой с телефоном в руке, и лишнее
 * нажатие на каждый переход — это то, чего рабочее место должно избегать.
 * Заголовки групп там же скрываются: подписи над однострочной лентой заняли бы
 * больше места, чем сама лента.
 */
function AdminNav({ slug, clubName, roles }: { slug: string; clubName: string | null; roles: Role[] }) {
  return (
    <nav
      aria-label="Рабочее место"
      className={cn(
        'shrink-0 lg:w-52 lg:py-10',
        // Колонка едет вместе со страницей до тех пор, пока не упрётся в шапку,
        // и дальше стоит: разделы должны быть под рукой на длинном дне.
        'lg:sticky lg:top-20 lg:self-start',
      )}
    >
      {clubName && (
        <p className="hidden truncate pb-3 text-[1rem] font-semibold lg:block" title={clubName}>
          {clubName}
        </p>
      )}

      <div
        className={cn(
          '-mx-5 flex gap-1 overflow-x-auto px-5 py-3 sm:-mx-8 sm:px-8',
          'border-b border-border',
          'lg:mx-0 lg:flex-col lg:overflow-visible lg:border-0 lg:px-0 lg:py-0',
        )}
      >
        <Group title="Операционка" sections={SHIFT.filter(visibleTo(roles))} slug={slug} />
        <Group title="Устройство клуба" sections={SETUP.filter(visibleTo(roles))} slug={slug} />
      </div>
    </nav>
  );
}

/** Раздел без ролей — всем в админке; с ролями — тем, у кого есть хоть одна. */
function visibleTo(roles: Role[]): (section: Section) => boolean {
  return (section) => !section.roles || section.roles.some((role) => roles.includes(role));
}

function Group({
  title,
  sections,
  slug,
}: {
  title: string;
  sections: Section[];
  slug: string;
}) {
  const pathname = usePathname();

  return (
    <>
      <p
        className={cn(
          'hidden text-[0.6875rem] tracking-[0.09em] text-text-subtle uppercase',
          'lg:block lg:px-3 lg:pt-4 lg:pb-1.5',
        )}
      >
        {title}
      </p>

      {sections.map((section) => {
        const href = clubPath(slug, section.path);
        // Совпадение по началу пути, а не точное: у разделов появятся вложенные
        // страницы (карточка человека внутри состава), и на них раздел обязан
        // оставаться подсвеченным.
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={section.path}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-control px-3 py-2 text-[0.875rem] whitespace-nowrap transition-colors',
              active
                ? 'bg-surface-accent-soft font-medium text-text-accent'
                : 'text-text-muted hover:bg-surface-sunken hover:text-text lg:hover:bg-surface',
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </>
  );
}
