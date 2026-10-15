'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useDisclosure } from '@/lib/useDisclosure';
import { useSession } from '@/lib/useSession';

/** Скрытая подсказка — свойство браузера, а не учётки: это подсказка, не данные. */
const HIDDEN_KEY = 'knt.first-steps.hidden';

type StepId = 'account' | 'notifications' | 'club' | 'favourite' | 'booking';

const STEPS: { id: StepId; label: string; hint: string; href: string }[] = [
  { id: 'account', label: 'Завести аккаунт', hint: 'Пара минут: почта и пароль', href: '/register' },
  {
    id: 'notifications',
    label: 'Включить уведомления',
    hint: 'Напомним о записи в MAX или в браузере',
    href: '/cabinet/edit/notifications',
  },
  { id: 'club', label: 'Найти клуб рядом', hint: 'Поиск по городу и названию', href: '#kluby' },
  { id: 'favourite', label: 'Добавить в избранное', hint: 'Сердечко у клуба или тренера', href: '/help/najti-klub' },
  {
    id: 'booking',
    label: 'Записаться на мероприятие',
    hint: 'Тренировка, турнир или стол',
    href: '/help/zapis-na-zanyatie',
  },
];

/**
 * «С чего начать» на стартовой (решение владельца от 02.10.2026): пять шагов
 * новичка. Сделанное отмечается само — по учётке, а не по нажатиям: шаг
 * сделан, если это видно по данным (есть привязка к клубу, избранное,
 * запись). Гостю виден первый шаг — завести аккаунт.
 *
 * С 15.10.2026 (просьба владельца: карточкой посреди страницы выглядело
 * урезанно) — кнопкой с кольцом прогресса в правом нижнем углу и списком
 * над ней. Исчезает, когда сделано всё или когда её скрыли.
 */
export function FirstSteps() {
  const session = useSession();
  const [done, setDone] = useState<Set<StepId> | null>(null);
  const [hidden, setHidden] = useState<boolean | null>(null);
  const panel = useDisclosure();

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(HIDDEN_KEY) === '1');
    } catch {
      setHidden(false);
    }
  }, []);

  useEffect(() => {
    if (session.status === 'anonymous') {
      setDone(new Set());
      return;
    }

    if (session.status !== 'ready') return;

    let cancelled = false;
    const user = session.user;

    void Promise.all([
      api.notificationSettings().catch(() => null),
      api.myClubs().catch(() => []),
      api.myCoaches().catch(() => []),
      api.myBookings().catch(() => []),
    ]).then(([notifications, clubs, coaches, bookings]) => {
      if (cancelled) return;

      const next = new Set<StepId>(['account']);
      // Включить нечем (ни бота, ни ключей браузера) — шаг не держит подсказку.
      const canNotify = notifications !== null && (notifications.max.available || notifications.push.available);
      const notified = notifications !== null && (notifications.max.linked || notifications.push.devices > 0);
      if (notified || !canNotify) next.add('notifications');
      if (user.memberships.length > 0 || clubs.length > 0) next.add('club');
      if (clubs.length > 0 || coaches.length > 0) next.add('favourite');
      if (bookings.length > 0) next.add('booking');
      setDone(next);
    });

    return () => {
      cancelled = true;
    };
  }, [session]);

  if (hidden !== false || done === null || done.size === STEPS.length) {
    return null;
  }

  function hide(): void {
    setHidden(true);
    try {
      window.localStorage.setItem(HIDDEN_KEY, '1');
    } catch {
      // Хранилище закрыто — подсказка скрыта до перезагрузки, этого хватает.
    }
  }

  const count = done.size;
  const total = STEPS.length;
  const nextStep = STEPS.find((step) => !done.has(step.id));

  return (
    // Левее кнопки «?» быстрой помощи: та стоит в самом углу на всех страницах.
    <div ref={panel.root} className="fixed right-[4.75rem] bottom-4 z-30 sm:right-[5.25rem] sm:bottom-6">
      <section
        id={panel.panelId}
        aria-labelledby="first-steps"
        hidden={!panel.open}
        className="absolute right-0 bottom-full mb-3 w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-card border border-border bg-surface-raised shadow-lg"
      >
        <header className="border-b border-border bg-surface-accent-soft px-5 pt-4 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[0.6875rem] font-semibold tracking-[0.1em] text-text-accent uppercase">С чего начать</p>
              <h2 id="first-steps" className="mt-1 font-display text-[1.0625rem] leading-snug text-text">
                Пять шагов до первой игры
              </h2>
            </div>
            <button
              type="button"
              onClick={panel.close}
              aria-label="Свернуть"
              className="-mt-1 -mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-subtle hover:bg-surface-sunken hover:text-text"
            >
              <svg
                viewBox="0 0 12 12"
                aria-hidden="true"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
              >
                <path d="M2.5 4.5 6 8l3.5-3.5" />
              </svg>
            </button>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised" aria-hidden="true">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${(count / total) * 100}%` }}
              />
            </div>
            <span className="text-[0.8125rem] text-text-muted tabular-nums">
              {count} из {total}
            </span>
          </div>
        </header>

        <ol className="grid gap-1 p-2">
          {STEPS.map((step, index) => {
            const ok = done.has(step.id);
            const current = step === nextStep;

            const marker = (
              <span
                aria-hidden="true"
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-full text-[0.75rem] font-semibold tabular-nums',
                  ok && 'bg-accent text-accent-text',
                  !ok && current && 'border-2 border-accent text-text-accent',
                  !ok && !current && 'border border-border-strong text-text-subtle',
                )}
              >
                {ok ? (
                  <svg
                    viewBox="0 0 12 12"
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 6.2 5 8.5l4.5-5" />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
            );

            const text = (
              <span className="min-w-0 grow">
                <span
                  className={cn(
                    'block text-[0.9375rem] leading-snug',
                    ok ? 'text-text-subtle line-through' : 'font-medium text-text',
                  )}
                >
                  {step.label}
                </span>
                {!ok && <span className="block text-[0.8125rem] leading-snug text-text-subtle">{step.hint}</span>}
              </span>
            );

            return (
              <li key={step.id}>
                {ok ? (
                  <div className="flex items-center gap-3 rounded-control px-3 py-2">
                    {marker}
                    {text}
                    <span className="sr-only">— сделано</span>
                  </div>
                ) : (
                  <Link
                    href={step.href}
                    onClick={panel.close}
                    className={cn(
                      'group flex items-center gap-3 rounded-control px-3 py-2.5 hover:bg-surface-sunken',
                      current && 'bg-surface-sunken/60',
                    )}
                  >
                    {marker}
                    {text}
                    <span
                      aria-hidden="true"
                      className="text-text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-text-accent"
                    >
                      →
                    </span>
                  </Link>
                )}
              </li>
            );
          })}
        </ol>

        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-[0.8125rem]">
          <Link
            href="/help"
            onClick={panel.close}
            className="font-medium text-text-accent underline-offset-2 hover:underline"
          >
            Как пользоваться КНТ
          </Link>
          <button type="button" onClick={hide} className="text-text-muted underline-offset-2 hover:underline">
            Больше не показывать
          </button>
        </footer>
      </section>

      <button
        type="button"
        onClick={panel.toggle}
        {...panel.buttonProps}
        className={cn(
          'flex items-center gap-2.5 rounded-full border border-border bg-surface-raised py-2 pr-4 pl-2 shadow-lg',
          'transition-colors hover:border-border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          panel.open && 'border-border-accent',
        )}
      >
        <ProgressRing count={count} total={total} />
        <span className="text-[0.875rem] font-medium text-text">С чего начать</span>
        <span className="sr-only">
          — сделано {count} из {total}
        </span>
      </button>
    </div>
  );
}

/** Кольцо прогресса на кнопке — то же «сколько сделано», что полоса в списке. */
function ProgressRing({ count, total }: { count: number; total: number }) {
  const radius = 15;
  const length = 2 * Math.PI * radius;
  const value = count / total;

  return (
    <span className="relative grid h-9 w-9 place-items-center" aria-hidden="true">
      <svg viewBox="0 0 36 36" className="absolute inset-0 h-9 w-9 -rotate-90">
        <circle cx="18" cy="18" r={radius} fill="none" strokeWidth={3} className="stroke-surface-sunken" />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - value)}
          className="stroke-accent transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span className="text-[0.6875rem] font-semibold text-text-accent tabular-nums">
        {count}/{total}
      </span>
    </span>
  );
}
