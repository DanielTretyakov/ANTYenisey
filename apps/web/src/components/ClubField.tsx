'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Клуб, в который человек вступает при регистрации.
 *
 * Показывается ТОЛЬКО когда человек пришёл со страницы клуба: аккаунт
 * заводится на платформе, и подставлять клуб тому, кто открыл регистрацию со
 * стартовой страницы, не за что.
 *
 * Не поле ввода: технический код («yenisey») человеку не нужен и менять его
 * он не должен — случайная правка увела бы регистрацию в чужой клуб или в
 * никуда. Показывается официальное название, полученное из API по коду.
 *
 * Пока название грузится, показывается код — так место не «прыгает» при
 * подстановке названия. Если API недоступен, останется код: форму это не
 * ломает, потому что в запрос всё равно уходит код, а не название.
 */
export function ClubField({ slug }: { slug: string }) {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .tenant(slug)
      .then((tenant) => {
        if (!cancelled) setName(tenant.name);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <div className="mb-5 rounded-control border border-border-accent bg-surface-accent-soft px-3.5 py-3">
      <span className="block text-[0.75rem] tracking-[0.12em] text-text-accent uppercase">Клуб</span>
      <span className="mt-0.5 block font-medium text-text">{name ?? slug}</span>
    </div>
  );
}
