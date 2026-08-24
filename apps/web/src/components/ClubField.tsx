'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { TENANT_SLUG } from '@/lib/config';

/**
 * Клуб, в который заводится или входит человек.
 *
 * Не поле ввода: технический код («yenisey») человеку не нужен и менять его
 * он не должен — случайная правка увела бы регистрацию в чужой клуб или в
 * никуда. Показывается официальное название, полученное из API по коду.
 *
 * Пока название грузится, показывается код — так место не «прыгает» при
 * подстановке названия. Если API недоступен, останется код: форму это не
 * ломает, потому что в запрос всё равно уходит код, а не название.
 */
export function ClubField() {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .tenant(TENANT_SLUG)
      .then((tenant) => {
        if (!cancelled) setName(tenant.name);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="club-field">
      <span className="club-label">Клуб</span>
      <span className="club-name">{name ?? TENANT_SLUG}</span>
    </div>
  );
}
