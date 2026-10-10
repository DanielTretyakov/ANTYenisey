'use client';

import { useEffect, useState } from 'react';
import type { ClosureRule, ClosureSlot, ClubCoach, TournamentType, TrainingType } from '@yenisey/types';
import { shortName } from '@yenisey/types';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { inputClassName } from '@/components/ui/Field';
import { formatDate, formatMinute } from '@/lib/bookingGrid';
import { markForOpening, planDayEvents, shiftDate, weekdayOf } from '@/lib/closureGrid';
import { cn } from '@/lib/cn';
import { useClubApi } from '@/lib/useClubApi';
import { resolveEvents } from './dayEvents';
import { messageOf } from './TemplateBoard';

/** Сколько дней открыть разом: этот, неделю или горизонт брони. */
const SPANS = [1, 7, 14] as const;

/** Что откроется в один день. */
interface DayPlan {
  date: string;
  slots: ClosureSlot[];
  saved: ClosureSlot[];
  lines: string[];
}

/**
 * «Открыть запись на все мероприятия» (решение владельца от 05.10.2026).
 *
 * Шаблон недели описывает, как зал живёт обычно, но занятие с записью из него
 * само не заводится: окна тренировок приходят «без записи», и прежде открыть
 * их можно было только перекраской каждой группы в каждом дне. Кнопка делает
 * это разом — за день, неделю или две (горизонт брони) — тем же путём, что
 * сохранение дня: метка `NEW_SESSION`, план `planDayEvents`, заведение и
 * `replaceDay`. Турниры из шаблона заводятся тем же сохранением.
 *
 * День, шедший по шаблону, при этом отвязывается от него: занятию нужно окно в
 * расписании даты. Об этом сказано в окне до нажатия.
 */
export function OpenBookingDialog({
  hallId,
  timezone,
  date,
  today,
  current,
  coaches,
  trainingTypes,
  tournamentTypes,
  capacity: initialCapacity,
  onDone,
  onClose,
}: {
  hallId: string;
  timezone: string;
  /** Открытый в сетке день — с него и начинается отсчёт. */
  date: string;
  today: string;
  /** Окна открытого дня как они в сетке сейчас, с несохранёнными правками, и до правки. */
  current: { slots: ClosureSlot[]; saved: ClosureSlot[] };
  coaches: ClubCoach[];
  trainingTypes: TrainingType[];
  tournamentTypes: TournamentType[];
  capacity: number;
  /** Открытые даты — чтобы отметить их отвязанными и перечитать день. */
  onDone: (opened: string[]) => void;
  onClose: () => void;
}) {
  const club = useClubApi();
  const [span, setSpan] = useState<(typeof SPANS)[number]>(1);
  const [capacity, setCapacity] = useState(initialCapacity);
  const [plans, setPlans] = useState<DayPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [report, setReport] = useState<{ opened: string[]; failed: string[] } | null>(null);

  const usable = {
    trainingTypeIds: new Set(trainingTypes.filter((type) => type.isActive).map((type) => type.id)),
    coachIds: new Set(coaches.map((coach) => coach.id)),
  };
  const typeName = (id: string): string => trainingTypes.find((type) => type.id === id)?.name ?? 'занятие';
  const cupName = (id: string): string => tournamentTypes.find((type) => type.id === id)?.name ?? 'турнир';
  const coachName = (id: string): string => shortName(coaches.find((coach) => coach.id === id)?.fullName ?? '');
  const time = (start: number, end: number): string => `${formatMinute(start)}–${formatMinute(end)}`;

  // Предпросмотр: что откроется в каждый день. Прошедшие дни не трогаются.
  useEffect(() => {
    let cancelled = false;

    setPlans(null);
    setError(null);

    const build = async (): Promise<DayPlan[]> => {
      let template: ClosureRule[] | null = null;
      const result: DayPlan[] = [];

      for (let offset = 0; offset < span; offset += 1) {
        const day = shiftDate(date, offset);

        if (day < today) continue;

        let slots: ClosureSlot[];
        let saved: ClosureSlot[];

        if (day === date) {
          ({ slots, saved } = current);
        } else {
          const stored = await club.daySchedule(hallId, day);

          if (stored.customised) {
            slots = stored.closures;
          } else {
            template ??= await club.template(hallId);
            slots = template.filter((rule) => rule.weekday === weekdayOf(day));
          }

          saved = slots;
        }

        const marked = markForOpening(slots, usable);
        const plan = planDayEvents(marked, saved);
        const lines = [
          ...plan.sessions.map(
            (session) =>
              `${typeName(session.trainingTypeId)} · ${coachName(session.coachId)} · ${time(session.startMinute, session.endMinute)}`,
          ),
          ...plan.tournaments.map(
            (cup) => `${cupName(cup.tournamentTypeId)} · ${time(cup.startMinute, cup.endMinute)}`,
          ),
        ];

        if (lines.length > 0) result.push({ date: day, slots: marked, saved, lines });
      }

      return result;
    };

    build()
      .then((result) => {
        if (!cancelled) setPlans(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause));
      });

    return () => {
      cancelled = true;
    };
    // Предпросмотр пересчитывается по выбору дней; списки и окна дня за время
    // жизни окна не меняются.
  }, [span]);

  const open = async (): Promise<void> => {
    if (!plans) return;

    const opened: string[] = [];
    const failed: string[] = [];

    // По дню за раз, а не разом: отказ одного дня (скажем, тип сняли с
    // продажи) не должен отменять уже открытые остальные.
    for (const [index, plan] of plans.entries()) {
      setProgress(`Открываю ${index + 1} из ${plans.length}: ${formatDate(plan.date)}`);

      try {
        const drafts = await resolveEvents(club, plan.slots, plan.saved, { date: plan.date, timezone, capacity });

        await club.replaceDay(hallId, plan.date, drafts);
        opened.push(plan.date);
      } catch (cause) {
        failed.push(`${formatDate(plan.date)}: ${messageOf(cause)}`);
      }
    }

    setProgress(null);
    setReport({ opened, failed });
    onDone(opened);
  };

  const sessions = plans?.reduce((sum, plan) => sum + plan.lines.length, 0) ?? 0;

  return (
    <Dialog
      title="Открыть запись на мероприятия"
      description="Тренировки «без записи» станут занятиями, на которые клиенты запишутся сами; турниры из шаблона заведутся на свои даты."
      onClose={() => (progress ? undefined : onClose())}
      size="lg"
    >
      <div className="grid gap-4 px-6 py-5 text-[0.9375rem]">
        {report ? (
          <>
            <p>
              {report.opened.length > 0
                ? `Запись открыта: ${report.opened.map(formatDate).join(', ')}.`
                : 'Ничего не открыто.'}
            </p>
            {report.failed.length > 0 && (
              <ul className="list-disc pl-5 text-[0.875rem] text-danger">
                {report.failed.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <Button type="button" onClick={onClose}>
                Готово
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex gap-1.5" role="radiogroup" aria-label="Сколько дней">
                {SPANS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={span === value}
                    disabled={progress !== null}
                    onClick={() => setSpan(value)}
                    className={cn(
                      'rounded-control border px-3 py-1.5 text-[0.875rem] transition-colors',
                      span === value
                        ? 'border-border-strong bg-surface-sunken text-text'
                        : 'border-border text-text-muted hover:bg-surface-sunken',
                    )}
                  >
                    {value === 1 ? 'Этот день' : `${value} дней`}
                  </button>
                ))}
              </div>

              <label className="flex items-center gap-2 text-[0.875rem] whitespace-nowrap text-text-muted">
                Мест в группе
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={capacity}
                  disabled={progress !== null}
                  onChange={(event) => setCapacity(Number(event.target.value))}
                  className={cn(inputClassName, 'w-20 py-1.5 text-[0.875rem]')}
                />
              </label>
            </div>

            {error && <p className="text-[0.875rem] text-danger">{error}</p>}

            {plans === null && !error && <p className="text-text-muted">Смотрю расписание…</p>}

            {plans !== null && plans.length === 0 && (
              <p className="text-text-muted">
                Открывать нечего: в эти дни нет тренировок без записи и турниров из шаблона.
              </p>
            )}

            {plans !== null && plans.length > 0 && (
              <ul className="max-h-[22rem] divide-y divide-border overflow-y-auto rounded-control border border-border">
                {plans.map((plan) => (
                  <li key={plan.date} className="px-4 py-2.5">
                    <p className="font-medium">{formatDate(plan.date)}</p>
                    <ul className="mt-0.5 text-[0.875rem] text-text-muted">
                      {plan.lines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}

            {plans !== null && plans.length > 0 && (
              <p className="text-[0.8125rem] text-text-subtle">
                Дни, которые шли по шаблону, отвяжутся от него: занятию нужно своё окно в расписании даты.
                Правки шаблона на них действовать перестанут — вернуть день к шаблону можно в любой момент,
                занятия без записей уйдут вместе с ним.
                {plans.some((plan) => plan.date === date) && ' Несохранённые правки этого дня сохранятся вместе с записью.'}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              {progress && <span className="mr-auto text-[0.875rem] text-text-muted">{progress}</span>}
              <Button type="button" variant="secondary" disabled={progress !== null} onClick={onClose}>
                Не надо
              </Button>
              <Button
                type="button"
                pending={progress !== null}
                disabled={!plans || plans.length === 0 || capacity < 1}
                onClick={() => void open()}
              >
                {sessions > 0 ? `Открыть запись · ${sessions}` : 'Открыть запись'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
