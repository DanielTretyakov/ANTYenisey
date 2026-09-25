'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { PublicUser } from '@yenisey/types';
import { PersonSwitch } from '@/components/family/PersonSwitch';
import { AppShell } from '@/components/layout/AppShell';
import { cn } from '@/lib/cn';
import { usePersonSwitch } from '@/lib/usePersonSwitch';
import { useSession } from '@/lib/useSession';
import { CABINET_SECTIONS, sectionHref, sectionsFor, type CabinetSection } from './sections';

type Family = ReturnType<typeof usePersonSwitch>;

const CabinetContext = createContext<{ user: PublicUser; family: Family } | null>(null);

/** Кто вошёл и за кого действует — для разделов редактора. */
export function useCabinet(): { user: PublicUser; family: Family } {
  const value = useContext(CabinetContext);

  if (!value) {
    throw new Error('useCabinet вне CabinetEditShell');
  }

  return value;
}

/**
 * Каркас редактора кабинета: меню разделов слева, раздел справа.
 *
 * Живёт в layout, а не в странице раздела: переход между разделами меняет
 * участок адреса, и страница раздела перемонтируется, а выбор «за кого»
 * (`usePersonSwitch`) и меню должны пережить переход.
 */
export function CabinetEditShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const family = usePersonSwitch();

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login?next=%2Fcabinet');
    }
  }, [session.status, router]);

  const user = session.status === 'ready' ? session.user : null;
  const current = (pathname.split('/')[3] ?? '') as CabinetSection;
  const section = CABINET_SECTIONS.find((item) => item.id === current);
  const forPerson = family.forPerson;
  const viewHref = forPerson ? `/cabinet?for=${forPerson}` : '/cabinet';

  return (
    <AppShell>
      <div className="mb-7">
        <p className="text-[0.75rem] tracking-[0.1em] text-text-subtle uppercase">Кабинет</p>
        <h1 className="mt-1 text-[1.75rem]">Редактор профиля</h1>
      </div>

      {user && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
          <SectionNav user={user} current={current} forPerson={forPerson} />

          <div className="min-w-0 max-w-2xl">
            {/* Над блоком редактирования, справа (решение владельца от
                25.09.2026): возврат к странице — там, где глаз заканчивает
                правку, а не в другом конце экрана. Слева в той же строке —
                переключатель «за кого», если он нужен разделу. */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              {section?.perPerson ? (
                <PersonSwitch people={family.children} selected={family.selected} onChoose={family.choose} />
              ) : (
                <span />
              )}
              <Link
                href={viewHref}
                className="ml-auto text-[0.875rem] text-text-accent underline-offset-2 hover:underline"
              >
                ← К странице игрока
              </Link>
            </div>

            <CabinetContext.Provider value={{ user, family }}>{children}</CabinetContext.Provider>
          </div>
        </div>
      )}
    </AppShell>
  );
}

/**
 * Меню разделов. На широком экране — колонка слева, на узком — бургер:
 * девять пунктов строкой на 375 px не помещаются, а столбиком над формой
 * отодвинули бы её за первый экран.
 */
function SectionNav({
  user,
  current,
  forPerson,
}: {
  user: PublicUser;
  current: CabinetSection;
  forPerson: string | null;
}) {
  const sections = sectionsFor();
  const currentLabel = sections.find((section) => section.id === current)?.label ?? 'Разделы';
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Переход закрывает меню: каркас не перемонтируется.
  useEffect(() => setOpen(false), [current]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent): void {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const links = (
    <ul className="grid gap-0.5">
      {sections.map((section) => (
        <li key={section.id}>
          <Link
            href={sectionHref(section.id, forPerson)}
            aria-current={section.id === current ? 'page' : undefined}
            className={cn(
              'block rounded-control px-3 py-2 text-[0.9375rem] transition-colors',
              section.id === current
                ? 'bg-surface-accent-soft font-medium text-text-accent'
                : 'text-text-muted hover:bg-surface-raised hover:text-text',
            )}
          >
            {section.label}
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <nav aria-label="Разделы кабинета">
      <div className="hidden lg:sticky lg:top-24 lg:block">{links}</div>

      <div ref={root} className="relative lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={listId}
          className={cn(
            'flex w-full items-center gap-3 rounded-control border border-border bg-surface-raised px-4 py-3',
            'text-left text-[0.9375rem] text-text',
          )}
        >
          <BurgerIcon />
          <span className="grow">{currentLabel}</span>
          <span className="text-[0.8125rem] text-text-subtle">все разделы</span>
        </button>

        {open && (
          <div
            id={listId}
            className="absolute top-full right-0 left-0 z-30 mt-1 rounded-control border border-border bg-surface p-1.5 shadow-lg"
          >
            {links}
          </div>
        )}
      </div>
    </nav>
  );
}

function BurgerIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-text-muted" aria-hidden="true">
      <path d="M3 5.5h14M3 10h14M3 14.5h14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
