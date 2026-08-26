'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  ClosurePurpose,
  ClubCoach,
  ClubPerson,
  TournamentType,
  TrainingType,
} from '@yenisey/types';
import { inputClassName } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { shortName } from '@/lib/names';
import type { PersonColor } from '@/lib/personColor';

/** Кисть «освободить»: отдельное значение, потому что назначением она не является. */
export const ERASER = 'ERASE';

export type Brush = ClosurePurpose | typeof ERASER;

export const PURPOSES: { value: ClosurePurpose; label: string; cell: string; chip: string }[] = [
  { value: 'RENT', label: 'Аренда', cell: 'bg-sky-500/55', chip: 'bg-sky-500/70' },
  { value: 'SPARRING', label: 'Спарринг', cell: 'bg-violet-500/55', chip: 'bg-violet-500/70' },
  { value: 'TRAINING', label: 'Тренировка', cell: 'bg-accent/65', chip: 'bg-accent/80' },
  { value: 'ROBOT', label: 'Робот', cell: 'bg-amber-500/55', chip: 'bg-amber-500/70' },
  { value: 'TOURNAMENT', label: 'Турнир', cell: 'bg-rose-500/55', chip: 'bg-rose-500/70' },
];

/**
 * OTHER в палитре нет, но в базе он остаётся.
 *
 * Назначение «другое» ничего не объясняло ни администратору через месяц, ни
 * статистике, и вместо него в сетке теперь турнир. Убирать значение из enum
 * нельзя: на него ссылаются уже заведённые окна, и цвет с подписью им нужны.
 */
const OTHER_CELL = 'bg-zinc-500/55';
const OTHER_MARK = '·';

export const PURPOSE_LABEL = new Map<ClosurePurpose, string>([
  ...PURPOSES.map((item) => [item.value, item.label] as const),
  ['OTHER', 'Другое'],
]);

/**
 * Однобуквенная метка назначения для клетки.
 *
 * Цвет клетки занят человеком, и обозначать назначение вторым цветом нельзя:
 * янтарный «робот» на оранжевом арендаторе не виден вовсе. Буква же читается
 * на любом фоне и занимает четырнадцать пикселей.
 */
export const PURPOSE_MARK = new Map<ClosurePurpose, string>([
  ['RENT', 'А'],
  ['SPARRING', 'С'],
  ['TRAINING', 'Т'],
  ['ROBOT', 'Р'],
  ['TOURNAMENT', 'К'],
  ['OTHER', OTHER_MARK],
]);
export const PURPOSE_CELL = new Map<ClosurePurpose, string>([
  ...PURPOSES.map((item) => [item.value, item.cell] as const),
  ['OTHER', OTHER_CELL],
]);
export const PURPOSE_CHIP = new Map<ClosurePurpose, string>(
  PURPOSES.map((item) => [item.value, item.chip] as const),
);

/** Кого прикрепляют к окну: тренера, клиента или никого. */
export function attachmentOf(purpose: Brush): 'coach' | 'client' | 'none' {
  if (purpose === 'TRAINING' || purpose === 'SPARRING') return 'coach';
  if (purpose === 'RENT' || purpose === 'ROBOT') return 'client';
  return 'none';
}

/**
 * Палитра сетки: чем закрашивать и кого к этому прикрепить.
 *
 * Тренер и клиент — часть кисти, а не настройка дня: чтобы поставить другого,
 * его выбирают здесь и закрашивают нужные часы, в том числе поверх уже
 * закрашенного.
 */
export function SchedulePalette({
  brush,
  onBrush,
  coaches,
  coachId,
  onCoach,
  client,
  onClient,
  colors,
  trainingTypes,
  trainingTypeId,
  onTrainingType,
  tournamentTypes,
  tournamentTypeId,
  onTournamentType,
  allowTournament,
}: {
  brush: Brush;
  onBrush: (brush: Brush) => void;
  coaches: ClubCoach[];
  coachId: string | null;
  onCoach: (id: string | null) => void;
  client: ClubPerson | null;
  onClient: (person: ClubPerson | null) => void;
  colors: Map<string, PersonColor>;
  trainingTypes: TrainingType[];
  trainingTypeId: string | null;
  onTrainingType: (id: string | null) => void;
  /** Типы турниров: из них турнир и собирается прямо здесь, в сетке. */
  tournamentTypes: TournamentType[];
  tournamentTypeId: string | null;
  onTournamentType: (id: string | null) => void;
  /**
   * В шаблоне недели турниров не бывает: у турнира дата проведения, а «каждую
   * субботу один и тот же турнир» — это не турнир, а серия разных. Кисть там
   * показывается погашенной, а не пропадает: иначе непонятно, куда она делась.
   */
  allowTournament: boolean;
}) {
  const attachment = attachmentOf(brush);
  const currentCoach = coaches.find((coach) => coach.id === coachId);
  const attachedId = attachment === 'coach' ? coachId : (client?.id ?? null);
  const attachedColor = attachedId ? colors.get(attachedId) : undefined;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {PURPOSES.map((purpose) => (
        <button
          key={purpose.value}
          type="button"
          aria-pressed={brush === purpose.value}
          disabled={purpose.value === 'TOURNAMENT' && !allowTournament}
          title={
            purpose.value === 'TOURNAMENT' && !allowTournament
              ? 'Турнир ставится на конкретную дату — переключитесь на «Отдельный день»'
              : undefined
          }
          onClick={() => onBrush(purpose.value)}
          className={cn(
            'flex items-center gap-2 rounded-control border px-3 py-1.5 text-[0.875rem] transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-45',
            brush === purpose.value
              ? 'border-border-strong bg-surface-sunken text-text'
              : 'border-border text-text-muted hover:bg-surface-sunken',
          )}
        >
          <span className={cn('h-3 w-3 rounded-sm', purpose.chip)} aria-hidden="true" />
          {purpose.label}
        </button>
      ))}

      <button
        type="button"
        aria-pressed={brush === ERASER}
        onClick={() => onBrush(ERASER)}
        className={cn(
          'rounded-control border px-3 py-1.5 text-[0.875rem] transition-colors',
          brush === ERASER
            ? 'border-border-strong bg-surface-sunken text-text'
            : 'border-border text-text-muted hover:bg-surface-sunken',
        )}
      >
        Освободить
      </button>

      {attachment === 'coach' && (
        <label className="ml-2 flex items-center gap-2 text-[0.875rem] text-text-muted">
          Тренер
          <select
            value={coachId ?? ''}
            onChange={(event) => onCoach(event.target.value || null)}
            className={cn(inputClassName, 'w-auto py-1.5 text-[0.875rem]')}
          >
            {/* У тренировки тренер обязателен, у спарринга — нет: спарринг
                заводят заранее, ещё не зная, кто его проведёт. */}
            {brush === 'SPARRING' && <option value="">не назначен</option>}
            {coaches.length === 0 && <option value="">тренеров нет</option>}
            {coaches.map((coach) => (
              <option key={coach.id} value={coach.id}>
                {coach.fullName}
              </option>
            ))}
          </select>
        </label>
      )}

      {attachment === 'client' && (
        <ClientPicker value={client} onChange={onClient} />
      )}

      {brush === 'TRAINING' && (
        <label className="flex items-center gap-2 text-[0.875rem] text-text-muted">
          Занятие
          <select
            value={trainingTypeId ?? ''}
            onChange={(event) => onTrainingType(event.target.value || null)}
            className={cn(inputClassName, 'w-auto py-1.5 text-[0.875rem]')}
          >
            {trainingTypes.length === 0 && <option value="">типов нет</option>}
            {trainingTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {brush === 'TOURNAMENT' && (
        <label className="flex items-center gap-2 text-[0.875rem] text-text-muted">
          Турнир
          <select
            value={tournamentTypeId ?? ''}
            onChange={(event) => onTournamentType(event.target.value || null)}
            className={cn(inputClassName, 'w-auto py-1.5 text-[0.875rem]')}
          >
            {tournamentTypes.length === 0 && <option value="">типов турниров нет</option>}
            {tournamentTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
                {type.ratingLabel ? ` (рейтинг ${type.ratingLabel})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {attachment !== 'none' && (
        <p className="flex w-full items-center gap-2 text-[0.8125rem] text-text-subtle">
          {attachedColor && (
            <span className={cn('h-3 w-3 rounded-sm', attachedColor.dot)} aria-hidden="true" />
          )}
          Закрашиваете: {PURPOSE_LABEL.get(brush as ClosurePurpose)?.toLowerCase()}
          {attachment === 'coach' && currentCoach ? `, ${shortName(currentCoach.fullName)}` : ''}
          {attachment === 'client' && client ? `, ${shortName(client.fullName)}` : ''}
          {attachment === 'client' && !client ? ', без клиента' : ''} — закрасьте нужные часы,
          поверх уже закрашенного тоже можно.
        </p>
      )}
    </div>
  );
}

/**
 * Выбор клиента поиском.
 *
 * Не выпадающий список: клиентов у клуба тысячи, и перебирать их глазами
 * нельзя. Ищем по мере ввода — по фамилии, почте или телефону, как их обычно и
 * помнят на стойке.
 */
function ClientPicker({
  value,
  onChange,
}: {
  value: ClubPerson | null;
  onChange: (person: ClubPerson | null) => void;
}) {
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
      api
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
  }, [query]);

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
    <div ref={box} className="relative ml-2 flex items-center gap-2 text-[0.875rem] text-text-muted">
      Клиент
      {value ? (
        <span className="flex items-center gap-2">
          <span className="text-text">{shortName(value.fullName)}</span>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery('');
            }}
            className="text-text-subtle underline hover:text-text"
          >
            убрать
          </button>
        </span>
      ) : (
        <input
          aria-label="Поиск клиента"
          placeholder="фамилия, почта, телефон"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className={cn(inputClassName, 'w-56 py-1.5 text-[0.875rem]')}
        />
      )}

      {open && !value && found.length > 0 && (
        <ul className="absolute top-full left-14 z-20 mt-1 max-h-56 w-72 overflow-auto rounded-control border border-border bg-surface-raised shadow-lg">
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
                <span className="block text-[0.75rem] text-text-subtle">{person.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && !value && query.trim().length >= 2 && found.length === 0 && (
        <span className="text-[0.8125rem] text-text-subtle">никого не нашлось</span>
      )}
    </div>
  );
}
