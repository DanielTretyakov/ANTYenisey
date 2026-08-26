'use client';

import { useState, type FormEvent } from 'react';
import type { BookingStep, ClubSettings } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { MoneyField } from '@/components/ui/MoneyField';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { api, ApiError } from '@/lib/api';
import { inputToKopecks, kopecksToInput } from '@/lib/money';

const BOOKING_STEPS: { value: BookingStep; label: string }[] = [
  { value: 'MIN_10', label: '10 минут' },
  { value: 'MIN_15', label: '15 минут' },
  { value: 'MIN_20', label: '20 минут' },
  { value: 'MIN_30', label: '30 минут' },
  { value: 'HOUR_1', label: '1 час' },
];

/**
 * Форма настроек в состоянии редактирования.
 *
 * Суммы и сроки держатся строками, а не числами: пока человек стирает старое
 * значение, поле законно пусто, и хранить это как число можно только через
 * NaN. Перевод в копейки и минуты — один раз, на отправке.
 */
type FormState = {
  name: string;
  timezone: string;
  bookingStep: BookingStep;
  tableHourPrice: string;
  tableExtra30MinPrice: string;
  hasRobotOption: boolean;
  robot30MinPrice: string;
  robot60MinPrice: string;
  robotExtra30MinPrice: string;
  noShowChargePercent: string;
  attendanceReminderAfterMinutes: string;
  attendanceAutoNoShowAfterMinutes: string;
  subscriptionBurnsOnNoShowOnly: boolean;
};

/** Копейки в строку поля; null — «не задано», а не ноль. */
function priceToInput(kopecks: number | null): string {
  return kopecks === null ? '' : kopecksToInput(kopecks);
}

function toForm(settings: ClubSettings): FormState {
  return {
    name: settings.name,
    timezone: settings.timezone,
    bookingStep: settings.bookingStep,
    tableHourPrice: kopecksToInput(settings.tableHourPrice),
    tableExtra30MinPrice: kopecksToInput(settings.tableExtra30MinPrice),
    hasRobotOption: settings.hasRobotOption,
    // Незаданная цена робота остаётся пустой, а не нулевой: ноль — это
    // «бесплатно», и подставлять его вместо «не задано» нельзя.
    robot30MinPrice: priceToInput(settings.robot30MinPrice),
    robot60MinPrice: priceToInput(settings.robot60MinPrice),
    robotExtra30MinPrice: priceToInput(settings.robotExtra30MinPrice),
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

export function SettingsForm({ initial }: { initial: ClubSettings }) {
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

    const collected = collect(form);

    if (typeof collected === 'string') {
      setErrors([collected]);
      return;
    }

    setErrors([]);
    setPending(true);

    try {
      const updated = await api.updateClubSettings(collected);
      // Форма перезаполняется ответом сервера, а не тем, что человек ввёл:
      // «400,5» превращается в «400,50», и видно, что именно сохранилось.
      setForm(toForm(updated));
      setSaved(true);
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

  const moneyInvalid = (value: string): boolean =>
    value.trim() !== '' && inputToKopecks(value) === null;

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

      {saved && <Alert tone="info">Настройки сохранены.</Alert>}

      <Card>
        <CardHeader title="Клуб" description="Как клуб называется и по какому времени живёт." />
        <CardBody>
          <Field
            label="Название"
            hint="Его видит клиент в формах входа и регистрации."
            value={form.name}
            onChange={(event) => set('name', event.target.value)}
            required
          />
          <Field
            label="Часовой пояс"
            hint="Зона IANA, например Asia/Krasnoyarsk. От неё зависят пороги отмены и границы дня."
            value={form.timezone}
            onChange={(event) => set('timezone', event.target.value)}
            required
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Аренда стола"
          description="Шаг сетки и цены. Клиент бронирует сам, без подтверждения администратора."
        />
        <CardBody>
          <Select
            label="Минимальный шаг брони"
            hint="Из него собирается сетка свободного времени."
            options={BOOKING_STEPS}
            value={form.bookingStep}
            onChange={(event) => set('bookingStep', event.target.value as BookingStep)}
          />

          <div className="grid gap-x-6 sm:grid-cols-2">
            <MoneyField
              label="Первый час"
              value={form.tableHourPrice}
              onChange={(value) => set('tableHourPrice', value)}
              invalid={moneyInvalid(form.tableHourPrice)}
            />
            <MoneyField
              label="Каждые следующие 30 минут"
              value={form.tableExtra30MinPrice}
              onChange={(value) => set('tableExtra30MinPrice', value)}
              invalid={moneyInvalid(form.tableExtra30MinPrice)}
            />
          </div>

          <Toggle
            label="Есть аренда «стол + робот»"
            hint="Отдельная услуга со своей сеткой цен, а не наценка поверх обычной аренды."
            checked={form.hasRobotOption}
            onChange={(event) => set('hasRobotOption', event.target.checked)}
          />

          {form.hasRobotOption && (
            <div className="grid gap-x-6 sm:grid-cols-3">
              <MoneyField
                label="30 минут"
                value={form.robot30MinPrice}
                onChange={(value) => set('robot30MinPrice', value)}
                invalid={moneyInvalid(form.robot30MinPrice)}
              />
              <MoneyField
                label="60 минут"
                value={form.robot60MinPrice}
                onChange={(value) => set('robot60MinPrice', value)}
                invalid={moneyInvalid(form.robot60MinPrice)}
              />
              <MoneyField
                label="Следующие 30 минут"
                value={form.robotExtra30MinPrice}
                onChange={(value) => set('robotExtra30MinPrice', value)}
                invalid={moneyInvalid(form.robotExtra30MinPrice)}
              />
            </div>
          )}
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

          <Toggle
            label="Визит абонемента сгорает только при неявке"
            hint="При любой отмене визит возвращается на баланс клиента."
            checked={form.subscriptionBurnsOnNoShowOnly}
            onChange={(event) => set('subscriptionBurnsOnNoShowOnly', event.target.checked)}
          />
        </CardBody>
      </Card>

      <div>
        <Button type="submit" pending={pending} size="lg">
          Сохранить настройки
        </Button>
      </div>
    </form>
  );
}

/**
 * Сбор формы в запрос. Возвращает текст ошибки, если что-то введено не числом,
 * — тогда до сервера дело не доходит.
 */
function collect(form: FormState): ClubSettings | string {
  const tableHourPrice = inputToKopecks(form.tableHourPrice);
  const tableExtra30MinPrice = inputToKopecks(form.tableExtra30MinPrice);

  if (tableHourPrice === null || tableExtra30MinPrice === null) {
    return 'Цены аренды указываются числом, например 400 или 400,50';
  }

  const robotPrices = {
    robot30MinPrice: form.robot30MinPrice.trim() === '' ? null : inputToKopecks(form.robot30MinPrice),
    robot60MinPrice: form.robot60MinPrice.trim() === '' ? null : inputToKopecks(form.robot60MinPrice),
    robotExtra30MinPrice:
      form.robotExtra30MinPrice.trim() === '' ? null : inputToKopecks(form.robotExtra30MinPrice),
  };

  if (form.hasRobotOption && Object.values(robotPrices).some((price) => price === null)) {
    return 'Опция робота включена — заполните все три цены числом';
  }

  const noShowChargePercent = toWholeNumber(form.noShowChargePercent);
  const attendanceReminderAfterMinutes = toWholeNumber(form.attendanceReminderAfterMinutes);
  const attendanceAutoNoShowAfterMinutes = toWholeNumber(form.attendanceAutoNoShowAfterMinutes);

  if (
    noShowChargePercent === null ||
    attendanceReminderAfterMinutes === null ||
    attendanceAutoNoShowAfterMinutes === null
  ) {
    return 'Проценты и сроки указываются целым числом';
  }

  return {
    name: form.name.trim(),
    timezone: form.timezone.trim(),
    bookingStep: form.bookingStep,
    tableHourPrice,
    tableExtra30MinPrice,
    hasRobotOption: form.hasRobotOption,
    ...robotPrices,
    noShowChargePercent,
    attendanceReminderAfterMinutes,
    attendanceAutoNoShowAfterMinutes,
    subscriptionBurnsOnNoShowOnly: form.subscriptionBurnsOnNoShowOnly,
  };
}
