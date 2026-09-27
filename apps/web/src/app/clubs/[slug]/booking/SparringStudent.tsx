'use client';

import { useEffect, useState } from 'react';
import type { SparringStudent, SparringType } from '@yenisey/types';
import { inputClassName } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';
import { useClubApi } from '@/lib/useClubApi';

/**
 * Ученик и тип спарринга (решение владельца от 26.09.2026). Ученик платит
 * цену типа, стол входит в неё; без ученика — стол под спарринг, как прежде.
 *
 * Типы подсказываются по возрасту ученика — сегодня; окончательно возраст
 * проверяет сервер на день спарринга.
 */
export function SparringStudentPicker({
  types,
  student,
  typeId,
  onStudent,
  onType,
}: {
  types: SparringType[];
  student: SparringStudent | null;
  typeId: string;
  onStudent: (student: SparringStudent | null) => void;
  onType: (typeId: string) => void;
}) {
  const club = useClubApi();
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<SparringStudent[] | null>(null);

  useEffect(() => {
    const query = search.trim();

    if (query.length < 2 || student) {
      setFound(null);
      return;
    }

    let cancelled = false;
    // Пауза: иначе каждая буква — отдельный поход в базу.
    const timer = setTimeout(() => {
      club
        .coachStudents(query)
        .then((rows) => {
          if (!cancelled) setFound(rows);
        })
        .catch(() => {
          if (!cancelled) setFound([]);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, student, club]);

  const active = types.filter((type) => type.isActive);
  const fitting = student
    ? active.filter(
        (type) =>
          (type.minAge === null || student.age >= type.minAge) && (type.maxAge === null || student.age <= type.maxAge),
      )
    : active;

  // Выбранный тип перестал подходить новому ученику — берём первый подходящий.
  useEffect(() => {
    if (!student) return;

    if (!fitting.some((type) => type.id === typeId)) {
      onType(fitting[0]?.id ?? '');
    }
  }, [student, fitting, typeId, onType]);

  if (active.length === 0) {
    return (
      <p className="mb-5 text-[0.8125rem] text-text-muted">
        Типов спарринга в клубе пока нет — стол берётся под спарринг без ученика.
      </p>
    );
  }

  return (
    <div className="mb-5 rounded-control border border-border p-3">
      <p className="mb-2 text-[0.8125rem] font-medium text-text-muted">Ученик</p>

      {student ? (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-[0.9375rem]">
          {student.fullName}
          <span className="text-text-subtle">· {student.age} лет</span>
          <button
            type="button"
            onClick={() => {
              onStudent(null);
              onType('');
              setSearch('');
            }}
            className="text-[0.8125rem] text-text-subtle underline-offset-2 hover:text-text hover:underline"
          >
            убрать
          </button>
        </p>
      ) : (
        <div className="mb-3">
          <input
            aria-label="Фамилия ученика"
            placeholder="Фамилия ученика — или оставьте пустым"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={cn(inputClassName, 'py-1.5 text-[0.875rem]')}
          />
          {found && (
            <ul className="mt-1 divide-y divide-border rounded-control border border-border">
              {found.length === 0 && (
                <li className="px-3 py-2 text-[0.8125rem] text-text-muted">Никого не нашлось в этом клубе.</li>
              )}
              {found.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => onStudent(person)}
                    className="w-full px-3 py-2 text-left text-[0.875rem] hover:bg-surface-sunken"
                  >
                    {person.fullName} <span className="text-text-subtle">· {person.age} лет</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-[0.8125rem] text-text-subtle">
            Без ученика стол берётся на вас: за неявку платите вы, как раньше.
          </p>
        </div>
      )}

      {student &&
        (fitting.length > 0 ? (
          <Select
            label="Тип спарринга"
            value={typeId}
            onChange={(event) => onType(event.target.value)}
            options={fitting.map((type) => ({
              value: type.id,
              label: `${type.name} · ${formatKopecks(type.hourPrice)} за час`,
            }))}
          />
        ) : (
          <p className="text-[0.8125rem] text-danger">
            Ни один тип спарринга не подходит ученику по возрасту — попросите администратора завести подходящий.
          </p>
        ))}
    </div>
  );
}
