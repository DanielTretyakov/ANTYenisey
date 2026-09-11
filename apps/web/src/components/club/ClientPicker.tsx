'use client';

import { useEffect, useRef, useState } from 'react';
import type { ClubPerson } from '@yenisey/types';
import { shortName } from '@yenisey/types';
import { inputClassName } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { useClubApi } from '@/lib/useClubApi';

/**
 * Выбор человека клуба поиском.
 *
 * Не выпадающий список: клиентов у клуба тысячи, и перебирать их глазами
 * нельзя. Ищем по мере ввода — по фамилии, почте или телефону, как их обычно и
 * помнят на стойке.
 *
 * Вынесено из палитры расписания, когда мест выбора клиента стало два: там
 * администратор закрепляет человека за окном, здесь — сажает за стол. Копия
 * разошлась бы с оригиналом на первой же правке поиска.
 *
 * Найти можно только того, кто уже состоит в клубе. Человек «с порога», без
 * учётки на платформе, сюда не попадёт — это отдельный сценарий ТЗ со своей
 * формой, и подпирать им поиск нельзя.
 */
export function ClientPicker({
  value,
  onChange,
  label = 'Клиент',
  /** Строкой в ряд с подписью (палитра расписания) или блоком во всю ширину (форма). */
  inline = false,
}: {
  value: ClubPerson | null;
  onChange: (person: ClubPerson | null) => void;
  label?: string;
  inline?: boolean;
}) {
  const club = useClubApi();

  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ClubPerson[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setFound([]);
      return;
    }

    let cancelled = false;
    // Пауза перед запросом: без неё каждая буква фамилии — отдельный поход в
    // базу, и ответы возвращаются вперемешку.
    const timer = setTimeout(() => {
      club
        .people({ role: 'CLIENT', search: query.trim(), limit: 8 })
        .then((page) => {
          if (!cancelled) setFound(page.items);
        })
        .catch(() => {
          if (!cancelled) setFound([]);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, club]);

  useEffect(() => {
    const close = (event: PointerEvent): void => {
      if (box.current && !box.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);

  return (
    <div
      ref={box}
      className={cn(
        'text-[0.875rem] text-text-muted',
        inline ? 'flex items-center gap-2' : 'grid gap-1.5',
      )}
    >
      <span className={cn(!inline && 'font-medium text-text')}>{label}</span>

      {value ? (
        <span className="flex items-center gap-2">
          {/* Найденного показываем сокращённо: полное имя в строке палитры не
              помещается, а узнать человека по «Соколов А.» достаточно. */}
          <span className="text-text">{inline ? shortName(value.fullName) : value.fullName}</span>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery('');
            }}
            className="text-text-subtle underline underline-offset-2 hover:text-text"
          >
            убрать
          </button>
        </span>
      ) : (
        // Обёртка нужна, чтобы список подсказок цеплялся к самому полю, а не к
        // строке целиком: иначе он уезжал бы влево, под подпись.
        <span className="relative block">
          <input
            aria-label={`Поиск: ${label.toLowerCase()}`}
            placeholder="фамилия, почта, телефон"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            className={cn(inputClassName, inline ? 'w-56 py-1.5 text-[0.875rem]' : 'w-full')}
          />

          {open && found.length > 0 && (
            <ul className="absolute top-full left-0 z-20 mt-1 max-h-56 w-full min-w-72 overflow-auto rounded-control border border-border bg-surface-raised shadow-lg">
              {found.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(person);
                      setOpen(false);
                    }}
                    className="block w-full px-3 py-2 text-left text-[0.875rem] text-text hover:bg-surface-sunken"
                  >
                    {person.fullName}
                    <span className="block text-[0.75rem] text-text-subtle">
                      {person.phone} · {person.email}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {open && query.trim().length >= 2 && found.length === 0 && (
            <span className="mt-1 block text-[0.8125rem] text-text-subtle">никого не нашлось</span>
          )}
        </span>
      )}
    </div>
  );
}
