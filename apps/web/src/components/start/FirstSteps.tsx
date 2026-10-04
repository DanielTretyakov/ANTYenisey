'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/useSession';

/** Закрытая карточка — свойство браузера, а не учётки: это подсказка, не данные. */
const HIDDEN_KEY = 'knt.first-steps.hidden';

type StepId = 'account' | 'notifications' | 'club' | 'favourite' | 'booking';

const STEPS: { id: StepId; label: string; href: string }[] = [
  { id: 'account', label: 'Завести аккаунт', href: '/register' },
  { id: 'notifications', label: 'Включить уведомления о записях', href: '/cabinet/edit/notifications' },
  { id: 'club', label: 'Найти клуб рядом', href: '#kluby' },
  { id: 'favourite', label: 'Добавить клуб или тренера в избранное', href: '/help/najti-klub' },
  { id: 'booking', label: 'Записаться на мероприятие', href: '/help/zapis-na-zanyatie' },
];

/**
 * «С чего начать» на стартовой (решение владельца от 02.10.2026): пять шагов
 * новичка. Сделанное зачёркивается само — по учётке, а не по нажатиям: шаг
 * сделан, если это видно по данным (есть привязка к клубу, избранное,
 * запись). Гостю виден первый шаг — завести аккаунт.
 *
 * Карточка исчезает, когда сделано всё, или когда её закрыли.
 */
export function FirstSteps() {
  const session = useSession();
  const [done, setDone] = useState<Set<StepId> | null>(null);
  const [hidden, setHidden] = useState<boolean | null>(null);

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
      // Включить нечем (ни бота, ни ключей браузера) — шаг не держит карточку.
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
      // Хранилище закрыто — карточка скрыта до перезагрузки, этого хватает.
    }
  }

  return (
    <section
      aria-labelledby="first-steps"
      className="mt-10 grid max-w-xl gap-4 rounded-card border border-border bg-surface-raised p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="first-steps" className="text-[0.75rem] font-semibold tracking-[0.1em] text-text-subtle uppercase">
          С чего начать
        </h2>
        <span className="text-[0.8125rem] text-text-subtle tabular-nums">
          {done.size} из {STEPS.length}
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
        <div className="h-full rounded-full bg-accent" style={{ width: `${(done.size / STEPS.length) * 100}%` }} />
      </div>

      <ol className="grid gap-2.5">
        {STEPS.map((step) => {
          const ok = done.has(step.id);

          return (
            <li key={step.id} className="flex items-center gap-3 text-[0.9375rem]">
              <span
                aria-hidden="true"
                className={cn(
                  'grid h-5 w-5 shrink-0 place-items-center rounded-[0.35rem] border text-[0.75rem]',
                  ok ? 'border-accent bg-accent text-accent-text' : 'border-border-strong',
                )}
              >
                {ok ? '✓' : ''}
              </span>
              {ok ? (
                <span className="text-text-subtle line-through">{step.label}</span>
              ) : (
                <Link href={step.href} className="text-text underline-offset-2 hover:underline">
                  {step.label}
                </Link>
              )}
              <span className="sr-only">{ok ? '— сделано' : ''}</span>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[0.8125rem]">
        <Link href="/help" className="text-text-accent underline underline-offset-2">
          Как пользоваться КНТ
        </Link>
        <button type="button" onClick={hide} className="text-text-muted underline-offset-2 hover:underline">
          Скрыть
        </button>
      </div>
    </section>
  );
}
