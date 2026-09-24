'use client';

import { useEffect, useState } from 'react';
import type {
  ClosurePurpose,
  ClubCoach,
  ClubPerson,
  TournamentType,
  TrainingType,
} from '@yenisey/types';
import { shortName } from '@yenisey/types';
import { ClientPicker } from '@/components/club/ClientPicker';
import { inputClassName } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { tintFill, tintMark, type PersonColor } from '@/lib/personColor';

/** Кисть «освободить»: отдельное значение, потому что назначением она не является. */
export const ERASER = 'ERASE';

export type Brush = ClosurePurpose | typeof ERASER;

/**
 * Назначения окна и краски, которыми они различаются в сетке.
 *
 * Цвета вычисляются из красок палитры (`tokens.css`), а не пишутся классами
 * Tailwind: сырой `bg-sky-500/55` не переключался по теме и по чёрному фону
 * давал грязь. Формулы — общие с раздачей цветов людям, см. `personColor.ts`.
 */
export const PURPOSES: { value: ClosurePurpose; label: string; cell: string; chip: string }[] = [
  { value: 'RENT', label: 'Аренда', cell: tintFill('var(--hue-blue)'), chip: tintMark('var(--hue-blue)') },
  { value: 'SPARRING', label: 'Спарринг', cell: tintFill('var(--hue-violet)'), chip: tintMark('var(--hue-violet)') },
  { value: 'TRAINING', label: 'Тренировка', cell: tintFill('var(--brand-600)'), chip: tintMark('var(--brand-600)') },
  { value: 'ROBOT', label: 'Робот', cell: tintFill('var(--hue-amber)'), chip: tintMark('var(--hue-amber)') },
  { value: 'TOURNAMENT', label: 'Турнир', cell: tintFill('var(--hue-rose)'), chip: tintMark('var(--hue-rose)') },
];

/**
 * OTHER в палитре нет, но в базе он остаётся.
 *
 * Назначение «другое» ничего не объясняло ни администратору через месяц, ни
 * статистике, и вместо него в сетке теперь турнир. Убирать значение из enum
 * нельзя: на него ссылаются уже заведённые окна, и цвет с подписью им нужны.
 *
 * Краска у него служебная — серый из нейтральной шкалы: «другое» не должно
 * выглядеть как ещё одно полноценное назначение.
 */
const OTHER_CELL = tintFill('var(--ink-500)');
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

/**
 * Кого прикрепляют к ОКНУ: только тренера.
 *
 * У аренды клиента нет: время, занятое человеком, — это бронь, а не окно.
 * Выбранный клиент в палитре кисть не меняет — он говорит, кого посадить.
 */
export function attachmentOf(purpose: Brush): 'coach' | 'none' {
  if (purpose === 'TRAINING' || purpose === 'SPARRING') return 'coach';
  return 'none';
}

/** Кистью аренды или робота сажают человека — если он выбран. */
export function seatsClient(purpose: Brush): boolean {
  return purpose === 'RENT' || purpose === 'ROBOT';
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
  capacity,
  onCapacity,
  askCapacity,
  tournamentTypes,
  tournamentTypeId,
  onTournamentType,
  allowClient,
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
  /**
   * Мест в группе. Спрашивается только в расписании даты: занятие с лимитом
   * мест заводится из закрашенного окна, а у повторяющегося шаблона недели
   * конкретного занятия нет — там остаётся один тип.
   */
  capacity: number;
  onCapacity: (capacity: number) => void;
  askCapacity: boolean;
  /** Типы турниров: из них турнир и собирается прямо здесь, в сетке. */
  tournamentTypes: TournamentType[];
  tournamentTypeId: string | null;
  onTournamentType: (id: string | null) => void;
  /**
   * Можно ли посадить клиента кистью аренды. Только в расписании даты: бронь
   * заводится на конкретное время, а шаблон недели повторяется — постоянного
   * арендатора сажают бронью на нужные даты, а не строкой шаблона.
   */
  allowClient: boolean;
}) {
  const attachment = attachmentOf(brush);
  const seating = allowClient && seatsClient(brush);
  const currentCoach = coaches.find((coach) => coach.id === coachId);
  const attachedId = attachment === 'coach' ? coachId : null;
  const attachedColor = attachedId ? colors.get(attachedId) : undefined;

  return (
    <div className="mb-3 grid gap-2.5">
      {/* Две строки, а не одна текучая (решение владельца от 24.09.2026):
          кисти — первой, всё, что уточняет кисть, — второй. В одну строку
          тренер и тип занятия то стояли рядом с кистями, то съезжали вниз
          по одному, и число мест оказывалось отдельно от них. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PURPOSES.map((purpose) => (
          <button
            key={purpose.value}
            type="button"
            aria-pressed={brush === purpose.value}
            onClick={() => onBrush(purpose.value)}
            className={cn(
              'flex items-center gap-2 rounded-control border px-3 py-1.5 text-[0.875rem] transition-colors',
              brush === purpose.value
                ? 'border-border-strong bg-surface-sunken text-text'
                : 'border-border text-text-muted hover:bg-surface-sunken',
            )}
          >
            <span
              className="h-3 w-3 rounded-sm"
              style={{ background: purpose.chip }}
              aria-hidden="true"
            />
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
      </div>

      {(attachment !== 'none' || seating || brush === 'TRAINING') && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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

          {attachment === 'coach' && (
            <label className="flex items-center gap-2 text-[0.875rem] text-text-muted">
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

          {brush === 'TRAINING' && askCapacity && (
            <label className="flex items-center gap-2 text-[0.875rem] text-text-muted">
              Мест
              <input
                type="number"
                min={1}
                max={200}
                value={capacity}
                onChange={(event) => onCapacity(Number(event.target.value))}
                className={cn(inputClassName, 'w-20 py-1.5 text-[0.875rem]')}
              />
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

          {seating && <ClientPicker value={client} onChange={onClient} inline />}
        </div>
      )}

      {(attachment !== 'none' || seating) && (
        <p className="flex w-full items-center gap-2 text-[0.8125rem] text-text-subtle">
          {attachedColor && (
            <span
              className="h-3 w-3 rounded-sm"
              style={{ background: attachedColor.dot }}
              aria-hidden="true"
            />
          )}
          {seating && client ? (
            <>
              Посадите {shortName(client.fullName)}: протяните по нужным часам — получится бронь с
              ценой, отменой и строкой в «Моих записях» у человека.
            </>
          ) : (
            <>
              Закрашиваете: {PURPOSE_LABEL.get(brush as ClosurePurpose)?.toLowerCase()}
              {attachment === 'coach' && currentCoach
                ? `, ${shortName(currentCoach.fullName)}`
                : ''}
              {seating ? ' без клиента — окно просто закроет стол' : ''} — закрасьте нужные часы,
              поверх уже закрашенного тоже можно.
            </>
          )}
        </p>
      )}
    </div>
  );
}
