'use client';

import type { Role } from '@yenisey/types';
import { rolesInClub } from '@/lib/membership';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { clubPath } from '@/components/layout/ClubNav';
import { NavSelect } from '@/components/ui/CompactSelect';
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
  // Акции и объявления клуба (решение владельца от 26.09.2026).
  { path: '/posts', label: 'Лента клуба' },
];

/** Устройство клуба: то, что настраивают редко и осознанно. */
const SETUP: Section[] = [
  { path: '/people', label: 'Состав клуба' },
  { path: '/catalog', label: 'Занятия и турниры' },
  { path: '/settings', label: 'Настройки' },
  // Подписка клуба на КНТ — только руководителю (решение от 02.10.2026).
  { path: '/billing', label: 'Подписка на КНТ', roles: ['OWNER'] },
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

      {/* Рабочему месту — подвал строкой: место нужнее (вариант Б, 03.10.2026). */}
      <SiteFooter variant="line" wide={wide} />
    </div>
  );
}

/**
 * Разделы рабочего места.
 *
 * Уже колонки (меньше `lg`) — выпадающий список «Раздел: Смена ▾» с группами
 * (решение владельца от 03.10.2026). Прежде здесь была лента с прокруткой
 * вбок: девять разделов в неё не влезали даже на планшете, и половина их
 * пряталась за краем экрана — администратор их просто не находил. Список
 * показывает все разделы сразу и текущий — словом.
 */
function AdminNav({ slug, clubName, roles }: { slug: string; clubName: string | null; roles: Role[] }) {
  const pathname = usePathname();
  const shift = SHIFT.filter(visibleTo(roles));
  const setup = SETUP.filter(visibleTo(roles));
  const current = [...shift, ...setup]
    .map((section) => clubPath(slug, section.path))
    .find((href) => pathname === href || pathname.startsWith(`${href}/`));

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

      {/* Клуб — и на телефоне: у руководителя двух клубов разделы одинаковые. */}
      {clubName && <p className="truncate pt-3 text-[0.8125rem] font-semibold text-text lg:hidden">{clubName}</p>}

      <div className="flex items-center gap-3 border-b border-border py-3 lg:hidden">
        <NavSelect
          label="Раздел"
          current={current ?? ''}
          options={[
            ...shift.map((section) => ({ href: clubPath(slug, section.path), label: section.label, group: 'Операционка' })),
            ...setup.map((section) => ({ href: clubPath(slug, section.path), label: section.label, group: 'Устройство клуба' })),
          ]}
          className="grow"
        />
        <SectionHelp slug={slug} short />
      </div>

      <div className="hidden lg:flex lg:flex-col">
        <Group title="Операционка" sections={shift} slug={slug} />
        <Group title="Устройство клуба" sections={setup} slug={slug} />
        <SectionHelp slug={slug} />
      </div>
    </nav>
  );
}

/** Статья справки о разделе рабочего места — по последнему участку пути. */
const SECTION_HELP: Record<string, string> = {
  '/desk': 'smena',
  '/schedule': 'raspisanie-zala',
  '/staff': 'raspisanie-personala',
  '/subscriptions': 'abonementy-u-stojki',
  '/posts': 'lenta-kluba',
  '/people': 'lyudi-kluba',
  '/settings': 'nastrojki-v-polnoch',
  '/billing': 'podpiska-knt',
};

/**
 * «Как это работает?» — статья справки о текущем разделе (решение от
 * 02.10.2026). Внизу колонки разделов, а не над страницей: у каждой страницы
 * свой заголовок и свои действия, и ссылка над ними спорила бы с ними.
 */
function SectionHelp({ slug, short = false }: { slug: string; short?: boolean }) {
  const pathname = usePathname();
  const section = Object.keys(SECTION_HELP).find((path) => {
    const href = clubPath(slug, path);
    return pathname === href || pathname.startsWith(`${href}/`);
  });

  if (!section) {
    return null;
  }

  return (
    <Link
      href={`/help/${SECTION_HELP[section]}`}
      aria-label={short ? 'Как это работает? Справка о разделе' : undefined}
      className={cn(
        'rounded-control py-2 text-[0.8125rem] whitespace-nowrap text-text-accent underline-offset-2 hover:underline',
        short ? 'shrink-0' : 'mt-4 px-3',
      )}
    >
      {/* Рядом со списком места мало — короче, смысл тот же. */}
      {short ? 'Справка' : 'Как это работает?'}
    </Link>
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
      <p className="px-3 pt-4 pb-1.5 text-[0.6875rem] tracking-[0.09em] text-text-subtle uppercase">
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
              active ? 'bg-surface-accent-soft font-medium text-text-accent' : 'text-text-muted hover:bg-surface hover:text-text',
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </>
  );
}
