'use client';

import { useState, type FormEvent } from 'react';
import type {
  SubscriptionPlan,
  SubscriptionPlanRequest,
  TournamentType,
  TrainingType,
} from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { MoneyField } from '@/components/ui/MoneyField';
import { Toggle } from '@/components/ui/Toggle';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatKopecks, inputToKopecks, kopecksToInput } from '@/lib/money';
import { planTermsLabel } from '@/lib/subscriptions';
import { useClubApi } from '@/lib/useClubApi';

/** Что правится в форме: строки полей, а не числа, — пока человек печатает. */
interface Draft {
  name: string;
  unlimited: boolean;
  visits: string;
  forever: boolean;
  days: string;
  price: string;
  trainingTypeIds: string[];
  tournamentTypeIds: string[];
}

const EMPTY: Draft = {
  name: '',
  unlimited: false,
  visits: '',
  forever: false,
  days: '30',
  price: '',
  trainingTypeIds: [],
  tournamentTypeIds: [],
};

function draftOf(plan: SubscriptionPlan): Draft {
  return {
    name: plan.name,
    unlimited: plan.visitsCount === null,
    visits: plan.visitsCount === null ? '' : String(plan.visitsCount),
    forever: plan.durationDays === null,
    days: plan.durationDays === null ? '' : String(plan.durationDays),
    price: kopecksToInput(plan.price),
    trainingTypeIds: plan.trainingTypeIds,
    tournamentTypeIds: plan.tournamentTypeIds,
  };
}

/**
 * Тарифы абонементов.
 *
 * Один тариф «Енисея» — это десяток вариантов по визитам и срокам («Первая
 * подача» на 5, 10, 20 визитов…), и каждый вариант — отдельная строка с тем же
 * названием. Поэтому список сгруппирован по названию, а новый вариант удобнее
 * всего заводить копией соседнего.
 *
 * Визиты, срок и цена у проданного абонемента уже зафиксированы: их правка
 * меняет только будущие продажи. Покрытие читается вживую, поэтому убрать
 * услугу из тарифа с действующими абонементами нельзя — только добавить.
 */
export function SubscriptionPlansCard({
  plans,
  trainingTypes,
  tournamentTypes,
  onChange,
}: {
  plans: SubscriptionPlan[];
  trainingTypes: TrainingType[];
  tournamentTypes: TournamentType[];
  onChange: (plans: SubscriptionPlan[]) => void;
}) {
  const club = useClubApi();
  // null — форма закрыта; 'new' — новый тариф; иначе — id правимого.
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeName = new Map<string, string>([
    ...trainingTypes.map((type) => [type.id, type.name] as const),
    ...tournamentTypes.map((type) => [type.id, type.name] as const),
  ]);

  const groups = [...new Set(plans.map((plan) => plan.name))].map((name) => ({
    name,
    variants: plans.filter((plan) => plan.name === name),
  }));

  function open(target: string | 'new', from: Draft): void {
    setError(null);
    setEditing(target);
    setDraft(from);
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setPending(true);
    setError(null);

    try {
      await action();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  /** Черновик в запрос. Ошибка ввода — текстом, до сервера. */
  function requestOf(from: Draft, isActive: boolean): SubscriptionPlanRequest | string {
    const price = inputToKopecks(from.price);
    const visits = from.unlimited ? null : Number(from.visits);
    const days = from.forever ? null : Number(from.days);

    if (price === null) return 'Цена указывается числом, например 5000';
    if (visits !== null && (!Number.isInteger(visits) || visits < 1)) return 'Визиты — целым числом от одного';
    if (days !== null && (!Number.isInteger(days) || days < 1)) return 'Срок — целым числом дней от одного';
    if (visits === null && days === null) return 'Безлимит без срока клуб не продаёт — укажите визиты или срок';

    return {
      name: from.name.trim(),
      visitsCount: visits,
      durationDays: days,
      price,
      isActive,
      trainingTypeIds: from.trainingTypeIds,
      tournamentTypeIds: from.tournamentTypeIds,
    };
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const current = editing && editing !== 'new' ? plans.find((plan) => plan.id === editing) : null;
    const request = requestOf(draft, current?.isActive ?? true);

    if (typeof request === 'string') {
      setError(request);
      return;
    }

    await run(async () => {
      const saved = current
        ? await club.updateSubscriptionPlan(current.id, request)
        : await club.createSubscriptionPlan(request);

      onChange(current ? plans.map((plan) => (plan.id === saved.id ? saved : plan)) : [...plans, saved]);
      setEditing(null);
    });
  }

  async function toggleActive(plan: SubscriptionPlan): Promise<void> {
    const request = requestOf(draftOf(plan), !plan.isActive);

    if (typeof request === 'string') return;

    await run(async () => {
      const saved = await club.updateSubscriptionPlan(plan.id, request);
      onChange(plans.map((item) => (item.id === saved.id ? saved : item)));
    });
  }

  const editedPlan = editing && editing !== 'new' ? plans.find((plan) => plan.id === editing) : null;
  // Уже покрытые услуги тарифа с действующими абонементами не снимаются:
  // клиент купил их, и отнять задним числом нельзя.
  const locked = new Set(
    editedPlan && editedPlan.activeSubscriptions > 0
      ? [...editedPlan.trainingTypeIds, ...editedPlan.tournamentTypeIds]
      : [],
  );

  return (
    <Card>
      <CardHeader
        title="Абонементы"
        description="Тарифы, которые продаёт клуб. Продаёт администратор из карточки человека, оплата — у стойки. Визиты, срок и цена фиксируются при продаже: их правка меняет только будущие продажи."
      />
      <CardBody>
        {error && <Alert>{error}</Alert>}

        {groups.length === 0 && (
          <p className="mb-4 text-[0.9375rem] text-text-muted">Тарифов пока нет.</p>
        )}

        {groups.map((group) => (
          <section key={group.name} className="mb-5">
            <h3 className="mb-1.5 text-[0.9375rem] font-medium">{group.name}</h3>
            <ul className="divide-y divide-border border-y border-border">
              {group.variants.map((plan) => (
                <li key={plan.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                  <span className={cn('min-w-[12rem] flex-1', !plan.isActive && 'text-text-subtle line-through')}>
                    <span className="block text-[0.9375rem]">
                      {planTermsLabel(plan.visitsCount, plan.durationDays)} · {formatKopecks(plan.price)}
                    </span>
                    <span className="block text-[0.8125rem] text-text-muted">
                      {[...plan.trainingTypeIds, ...plan.tournamentTypeIds]
                        .map((id) => typeName.get(id) ?? '—')
                        .join(', ')}
                    </span>
                  </span>
                  {plan.activeSubscriptions > 0 && (
                    <span className="text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">
                      действует: {plan.activeSubscriptions}
                    </span>
                  )}
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => open(plan.id, draftOf(plan))}>
                    Изменить
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => open('new', { ...draftOf(plan), visits: '', days: plan.durationDays ? String(plan.durationDays) : '' })}
                  >
                    Копировать
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => void toggleActive(plan)}>
                    {plan.isActive ? 'Снять с продажи' : 'Вернуть'}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {editing === null ? (
          <Button variant="secondary" onClick={() => open('new', EMPTY)}>
            Новый тариф
          </Button>
        ) : (
          <form onSubmit={(event) => void save(event)} className="rounded-control border border-border p-4">
            <h3 className="mb-4 text-[0.9375rem] font-medium">
              {editing === 'new' ? 'Новый тариф' : 'Правка тарифа'}
            </h3>

            <Field
              label="Название"
              hint="Варианты одного тарифа — с одинаковым названием: так они окажутся рядом."
              value={draft.name}
              maxLength={100}
              required
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />

            <div className="grid gap-x-6 sm:grid-cols-2">
              <div>
                <Toggle
                  label="Безлимит"
                  checked={draft.unlimited}
                  onChange={(event) => setDraft({ ...draft, unlimited: event.target.checked })}
                />
                {!draft.unlimited && (
                  <Field
                    label="Визитов"
                    type="number"
                    min={1}
                    max={1000}
                    value={draft.visits}
                    onChange={(event) => setDraft({ ...draft, visits: event.target.value })}
                  />
                )}
              </div>
              <div>
                <Toggle
                  label="Бессрочно"
                  checked={draft.forever}
                  onChange={(event) => setDraft({ ...draft, forever: event.target.checked })}
                />
                {!draft.forever && (
                  <Field
                    label="Срок, дней"
                    hint="До конца местного дня последнего из них."
                    type="number"
                    min={1}
                    max={3650}
                    value={draft.days}
                    onChange={(event) => setDraft({ ...draft, days: event.target.value })}
                  />
                )}
              </div>
            </div>

            <MoneyField label="Цена" value={draft.price} onChange={(price) => setDraft({ ...draft, price })} className="max-w-48" />

            <CoverageList
              title="Какие тренировки покрывает"
              types={trainingTypes}
              selected={draft.trainingTypeIds}
              locked={locked}
              onChange={(trainingTypeIds) => setDraft({ ...draft, trainingTypeIds })}
            />
            <CoverageList
              title="Какие турниры покрывает"
              types={tournamentTypes}
              selected={draft.tournamentTypeIds}
              locked={locked}
              onChange={(tournamentTypeIds) => setDraft({ ...draft, tournamentTypeIds })}
            />

            {locked.size > 0 && (
              <p className="mb-4 text-[0.8125rem] text-text-subtle">
                По тарифу есть действующие абонементы — отмеченные услуги не снимаются, только добавляются.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" pending={pending} disabled={draft.name.trim() === ''}>
                Сохранить
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Отмена
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function CoverageList({
  title,
  types,
  selected,
  locked,
  onChange,
}: {
  title: string;
  types: { id: string; name: string }[];
  selected: string[];
  locked: Set<string>;
  onChange: (ids: string[]) => void;
}) {
  if (types.length === 0) {
    return null;
  }

  return (
    <fieldset className="mb-4">
      <legend className="mb-1.5 text-[0.8125rem] font-medium text-text-muted">{title}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {types.map((type) => {
          const checked = selected.includes(type.id);
          const fixed = checked && locked.has(type.id);

          return (
            <label key={type.id} className={cn('flex items-center gap-2 text-[0.9375rem]', fixed && 'text-text-muted')}>
              <input
                type="checkbox"
                checked={checked}
                disabled={fixed}
                onChange={(event) =>
                  onChange(event.target.checked ? [...selected, type.id] : selected.filter((id) => id !== type.id))
                }
              />
              {type.name}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
