'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { BookingStep, Hall } from '@yenisey/types';
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

type FormState = {
  name: string;
  bookingStep: BookingStep;
  tableHourPrice: string;
  tableExtra30MinPrice: string;
  hasRobotOption: boolean;
  robot30MinPrice: string;
  robot60MinPrice: string;
  robotExtra30MinPrice: string;
};

/** Копейки в строку поля; null — «не задано», а не ноль. */
function priceToInput(kopecks: number | null): string {
  return kopecks === null ? '' : kopecksToInput(kopecks);
}

function toForm(hall: Hall): FormState {
  return {
    name: hall.name,
    bookingStep: hall.bookingStep,
    tableHourPrice: kopecksToInput(hall.tableHourPrice),
    tableExtra30MinPrice: kopecksToInput(hall.tableExtra30MinPrice),
    hasRobotOption: hall.hasRobotOption,
    // Незаданная цена робота остаётся пустой, а не нулевой: ноль — это
    // «бесплатно», и подставлять его вместо «не задано» нельзя.
    robot30MinPrice: priceToInput(hall.robot30MinPrice),
    robot60MinPrice: priceToInput(hall.robot60MinPrice),
    robotExtra30MinPrice: priceToInput(hall.robotExtra30MinPrice),
  };
}

/**
 * Настройки одного зала: цены и шаг бронирования.
 *
 * Живут у зала, а не у клуба, потому что залы различаются именно тем, что
 * стоит денег: оборудованием, размером, наличием роботов.
 */
export function HallForm({
  hall,
  canDelete,
  onSaved,
  onDeleted,
}: {
  hall: Hall;
  /** Единственный зал клуба удалить нельзя: без зала не завести ни стол, ни цену. */
  canDelete: boolean;
  onSaved: (hall: Hall) => void;
  onDeleted: (hallId: string) => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(hall));
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Переключение зала вкладками не размонтирует форму — состояние надо
  // перезалить руками, иначе в новом зале окажутся цены предыдущего.
  useEffect(() => {
    setForm(toForm(hall));
    setErrors([]);
    setSaved(false);
    setConfirmingDelete(false);
  }, [hall]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((previous) => ({ ...previous, [key]: value }));
    setSaved(false);
  }

  const moneyInvalid = (value: string): boolean =>
    value.trim() !== '' && inputToKopecks(value) === null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const tableHourPrice = inputToKopecks(form.tableHourPrice);
    const tableExtra30MinPrice = inputToKopecks(form.tableExtra30MinPrice);

    if (tableHourPrice === null || tableExtra30MinPrice === null) {
      setErrors(['Цены аренды указываются числом, например 400 или 400,50']);
      return;
    }

    const robotPrices = {
      robot30MinPrice:
        form.robot30MinPrice.trim() === '' ? null : inputToKopecks(form.robot30MinPrice),
      robot60MinPrice:
        form.robot60MinPrice.trim() === '' ? null : inputToKopecks(form.robot60MinPrice),
      robotExtra30MinPrice:
        form.robotExtra30MinPrice.trim() === '' ? null : inputToKopecks(form.robotExtra30MinPrice),
    };

    if (form.hasRobotOption && Object.values(robotPrices).some((price) => price === null)) {
      setErrors(['Опция робота включена — заполните все три цены числом']);
      return;
    }

    setErrors([]);
    setPending(true);

    try {
      const updated = await api.updateHall(hall.id, {
        name: form.name.trim(),
        bookingStep: form.bookingStep,
        tableHourPrice,
        tableExtra30MinPrice,
        hasRobotOption: form.hasRobotOption,
        ...robotPrices,
      });

      // Форма перезаполняется ответом сервера, а не тем, что человек ввёл:
      // «400,5» превращается в «400,50», и видно, что именно сохранилось.
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

  async function handleDelete(): Promise<void> {
    setErrors([]);
    setPending(true);

    try {
      await api.deleteHall(hall.id);
      onDeleted(hall.id);
    } catch (cause) {
      setErrors([cause instanceof ApiError ? cause.message : 'Сервис недоступен']);
      setConfirmingDelete(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader
          title="Зал"
          description="Цены и шаг сетки. Клиент бронирует сам, без подтверждения администратора."
        />
        <CardBody>
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

          {saved && <Alert tone="info">Настройки зала сохранены.</Alert>}

          <div className="grid gap-x-6 sm:grid-cols-2">
            <Field
              label="Название зала"
              value={form.name}
              onChange={(event) => set('name', event.target.value)}
              required
            />
            <Select
              label="Минимальный шаг брони"
              hint="Из него собирается сетка свободного времени для клиента."
              options={BOOKING_STEPS}
              value={form.bookingStep}
              onChange={(event) => set('bookingStep', event.target.value as BookingStep)}
            />
          </div>

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
            label="В зале есть аренда «стол + робот»"
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

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button type="submit" pending={pending}>
              Сохранить зал
            </Button>

            {canDelete &&
              (confirmingDelete ? (
                <>
                  <span className="text-[0.875rem] text-text-muted">Удалить зал?</span>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={pending}
                    onClick={() => void handleDelete()}
                  >
                    Да, удалить
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Отмена
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => setConfirmingDelete(true)}
                >
                  Удалить зал
                </Button>
              ))}
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
