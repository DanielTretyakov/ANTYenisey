'use client';

import { useState, type FormEvent } from 'react';
import type { ClubSettings } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { timezoneOptions } from '@/lib/timezones';

/**
 * Настройки клуба: общие для всех его залов.
 *
 * Цен и шага бронирования здесь нет — они у зала. Здесь остаётся то, что
 * составляет договор клуба с клиентом: как его зовут, по какому времени он
 * живёт, что бывает при неявке и как ведут себя абонементы. Разные правила
 * отмены в двух залах одного клуба пришлось бы отдельно оговаривать в оферте.
 *
 * Сроки держатся строками, а не числами: пока человек стирает старое значение,
 * поле законно пусто, и хранить это как число можно только через NaN.
 */
type FormState = {
  name: string;
  timezone: string;
  noShowChargePercent: string;
  attendanceReminderAfterMinutes: string;
  attendanceAutoNoShowAfterMinutes: string;
  subscriptionBurnsOnNoShowOnly: boolean;
};

function toForm(settings: ClubSettings): FormState {
  return {
    name: settings.name,
    timezone: settings.timezone,
    noShowChargePercent: String(settings.noShowChargePercent),
    attendanceReminderAfterMinutes: String(settings.attendanceReminderAfterMinutes),
    attendanceAutoNoShowAfterMinutes: String(settings.attendanceAutoNoShowAfterMinutes),
    subscriptionBurnsOnNoShowOnly: settings.subscriptionBurnsOnNoShowOnly,
  };
}

/** Целое неотрицательное число из поля, или null, если введено не число. */
function toWholeNumber(value: string): number | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

export function SettingsForm({
  initial,
  onSaved,
}: {
  initial: ClubSettings;
  /** Часовой пояс нужен расписанию — сообщаем наверх, когда он изменился. */
  onSaved: (settings: ClubSettings) => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((previous) => ({ ...previous, [key]: value }));
    setSaved(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const noShowChargePercent = toWholeNumber(form.noShowChargePercent);
    const attendanceReminderAfterMinutes = toWholeNumber(form.attendanceReminderAfterMinutes);
    const attendanceAutoNoShowAfterMinutes = toWholeNumber(form.attendanceAutoNoShowAfterMinutes);

    if (
      noShowChargePercent === null ||
      attendanceReminderAfterMinutes === null ||
      attendanceAutoNoShowAfterMinutes === null
    ) {
      setErrors(['Проценты и сроки указываются целым числом']);
      return;
    }

    setErrors([]);
    setPending(true);

    try {
      const updated = await api.updateClubSettings({
        name: form.name.trim(),
        timezone: form.timezone,
        noShowChargePercent,
        attendanceReminderAfterMinutes,
        attendanceAutoNoShowAfterMinutes,
        subscriptionBurnsOnNoShowOnly: form.subscriptionBurnsOnNoShowOnly,
      });

      setForm(toForm(updated));
      setSaved(true);
      onSaved(updated);
    } catch (cause) {
      setErrors(
        cause instanceof ApiError
          ? cause.message.split('; ')
          : ['Сервис недоступен, попробуйте позже'],
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      {errors.length > 0 && (
        <Alert>
          {errors.length === 1 ? (
            errors[0]
          ) : (
            <ul className="list-disc space-y-1 pl-4">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      {saved && <Alert tone="info">Настройки клуба сохранены.</Alert>}

      <Card>
        <CardHeader
          title="Клуб"
          description="Общее для всех залов: как клуб называется и по какому времени живёт."
        />
        <CardBody>
          <Field
            label="Название"
            hint="Его видит клиент в формах входа и регистрации."
            value={form.name}
            onChange={(event) => set('name', event.target.value)}
            required
          />
          <Select
            label="Часовой пояс"
            hint="От него считаются пороги отмены, напоминания и то, какой дате принадлежит расписание."
            options={timezoneOptions(initial.timezone)}
            value={form.timezone}
            onChange={(event) => set('timezone', event.target.value)}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Присутствие и неявка"
          description="Что происходит, когда клиент не отменил бронь и не пришёл."
        />
        <CardBody>
          <div className="grid gap-x-6 sm:grid-cols-3">
            <Field
              label="Списать при неявке, %"
              inputMode="numeric"
              value={form.noShowChargePercent}
              onChange={(event) => set('noShowChargePercent', event.target.value)}
            />
            <Field
              label="Напомнить админу через, мин"
              inputMode="numeric"
              value={form.attendanceReminderAfterMinutes}
              onChange={(event) => set('attendanceReminderAfterMinutes', event.target.value)}
            />
            <Field
              label="Зафиксировать неявку через, мин"
              inputMode="numeric"
              value={form.attendanceAutoNoShowAfterMinutes}
              onChange={(event) => set('attendanceAutoNoShowAfterMinutes', event.target.value)}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Абонементы"
          description="Что происходит с визитом на балансе, когда бронь не состоялась. Денег это не касается: абонемент уже оплачен, и штраф за отмену к нему не применяется."
        />
        <CardBody>
          <Toggle
            label="Мягкое правило: визит сгорает только при неявке"
            checked={form.subscriptionBurnsOnNoShowOnly}
            onChange={(event) => set('subscriptionBurnsOnNoShowOnly', event.target.checked)}
          />

          <SubscriptionRules soft={form.subscriptionBurnsOnNoShowOnly} />
        </CardBody>
      </Card>

      <div>
        <Button type="submit" pending={pending} size="lg">
          Сохранить настройки клуба
        </Button>
      </div>
    </form>
  );
}

/**
 * Разбор трёх случаев, которыми отличаются мягкое и строгое правила.
 *
 * Одного переключателя мало: «сгорает только при неявке» не говорит, что
 * будет с поздней отменой, а именно она и есть спорный случай. Поэтому
 * показаны все три исхода сразу, и различающийся выделен.
 */
function SubscriptionRules({ soft }: { soft: boolean }) {
  const rules = [
    {
      event: 'Клиент отменил заранее',
      detail: 'не позднее порога из политики отмены клуба',
      outcome: 'Визит возвращается на баланс',
      differs: false,
    },
    {
      event: 'Клиент отменил поздно',
      detail: 'позже порога, вплоть до самого начала',
      outcome: soft ? 'Визит возвращается на баланс' : 'Визит сгорает',
      differs: true,
    },
    {
      event: 'Клиент не отменил и не пришёл',
      detail: 'неявку отмечает администратор или система',
      outcome: 'Визит сгорает',
      differs: false,
    },
  ];

  return (
    <>
      <dl className="mt-1 divide-y divide-border border-y border-border">
        {rules.map((rule) => (
          <div key={rule.event} className="grid gap-1 py-3 sm:grid-cols-2 sm:gap-4">
            <dt>
              <span className="text-[0.9375rem] text-text">{rule.event}</span>
              <span className="block text-[0.8125rem] text-text-subtle">{rule.detail}</span>
            </dt>
            <dd
              className={cn(
                'text-[0.9375rem]',
                rule.differs ? 'font-medium text-text-accent' : 'text-text-muted',
              )}
            >
              {rule.outcome}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-[0.875rem] text-text-muted">
        {soft
          ? 'Так работает «Енисей» по ТЗ: отменить запись можно в любой момент, даже за пять минут до начала, и визит сохранится. Правило мягче, чем для оплаты картой, — там поздняя отмена всё равно стоит денег.'
          : 'Строгое правило: визит подчиняется той же политике отмены, что и оплата картой, — поздняя отмена сгорает наравне с неявкой. Для «Енисея» в ТЗ описано мягкое правило, так что этот вариант — отступление от него.'}
      </p>
    </>
  );
}
