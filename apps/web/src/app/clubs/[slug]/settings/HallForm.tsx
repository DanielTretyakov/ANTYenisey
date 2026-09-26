'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { BookingStep, Hall } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { MoneyField } from '@/components/ui/MoneyField';
import { AddressCombobox, type ChosenAddress } from '@/components/ui/AddressCombobox';
import { CityCombobox } from '@/components/ui/CityCombobox';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { ApiError } from '@/lib/api';
import { changedOnly } from '@/lib/changed';
import { useClubApi } from '@/lib/useClubApi';
import { inputToKopecks, kopecksToInput } from '@/lib/money';
import { timezoneOptions } from '@/lib/timezones';

const BOOKING_STEPS: { value: BookingStep; label: string }[] = [
  { value: 'MIN_10', label: '10 минут' },
  { value: 'MIN_15', label: '15 минут' },
  { value: 'MIN_20', label: '20 минут' },
  { value: 'MIN_30', label: '30 минут' },
  { value: 'HOUR_1', label: '1 час' },
];

type FormState = {
  name: string;
  timezone: string;
  cityId: string;
  /** Дом из справочника; пусто — зал заведён до 25.09.2026 и адреса не имеет. */
  address: ChosenAddress | null;
  phone: string;
  email: string;
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
    timezone: hall.timezone,
    cityId: hall.cityId ?? '',
    address: hall.address && hall.addressFiasId ? { value: hall.address, fiasId: hall.addressFiasId } : null,
    phone: hall.phone ?? '',
    email: hall.email ?? '',
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
 * Настройки одного зала: где он находится, по какому времени живёт, сколько
 * стоит и каким шагом бронируется.
 *
 * Живут у зала, а не у клуба, потому что залы различаются именно тем, что
 * стоит денег: оборудованием, размером, наличием роботов. Часовой пояс здесь
 * по той же причине: залы одной организации бывают в разных регионах, и общий
 * на клуб пояс сдвинул бы в одном из них границы операционного дня и порог
 * «за час до начала», от которого считаются деньги.
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
  const [deleteQueued, setDeleteQueued] = useState(false);

  const club = useClubApi();


  // Переключение зала вкладками не размонтирует форму — состояние надо
  // перезалить руками, иначе в новом зале окажутся цены предыдущего. Только
  // по смене зала, а не по новому объекту: после сохранения родитель кладёт
  // зал «каким он станет», и сброс по нему стёр бы «Сохранено».
  useEffect(() => {
    setForm(toForm(hall));
    setErrors([]);
    setSaved(false);
    setConfirmingDelete(false);
    setDeleteQueued(false);
  }, [hall.id]);

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

    if (!form.address) {
      setErrors(['Укажите адрес зала — выберите дом из подсказок']);
      return;
    }

    setErrors([]);

    // Только изменённое относительно показанного: зал с запланированной
    // правкой иначе получил бы её в очередь второй раз.
    const changes = changedOnly(
      {
        name: form.name.trim(),
        timezone: form.timezone,
        // Пустое поле означает «не задано», а не пустую строку.
        cityId: form.cityId || null,
        // Код дома — только если адрес сменили: сервер перепроверяет его у
        // справочника, и незачем тратить запрос на неизменённый.
        ...(form.address.fiasId !== hall.addressFiasId ? { addressFiasId: form.address.fiasId } : {}),
        // Пусто — «своих контактов нет», посетитель звонит в клуб.
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        bookingStep: form.bookingStep,
        tableHourPrice,
        tableExtra30MinPrice,
        hasRobotOption: form.hasRobotOption,
        ...robotPrices,
      },
      hall,
    );

    if (Object.keys(changes).length === 0) {
      setSaved(true);
      return;
    }

    setPending(true);

    try {
      const updated = await club.updateHall(hall.id, changes);

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
      await club.deleteHall(hall.id);
      setConfirmingDelete(false);
      setDeleteQueued(true);
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

          {saved && (
            <Alert tone="info">Сохранено. Вступит в силу в ближайшие 00:00 по времени зала.</Alert>
          )}
          {deleteQueued && (
            <Alert tone="info">
              Зал будет удалён в ближайшие 00:00. Передумали — отмените в «Запланированных изменениях».
            </Alert>
          )}

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
            <Select
              label="Часовой пояс зала"
              hint="От него считаются пороги отмены, напоминания и то, какой дате принадлежит расписание. У каждого зала свой."
              options={timezoneOptions(hall.timezone)}
              value={form.timezone}
              onChange={(event) => set('timezone', event.target.value)}
            />
            <CityCombobox
              className="mb-4"
              label="Город зала"
              hint="Поиск на стартовой странице находит клуб и по городу зала, а не только по городу клуба."
              emptyLabel="Не указан"
              value={form.cityId || null}
              onChange={(city) => set('cityId', city?.id ?? '')}
            />
          </div>

          <AddressCombobox
            label="Адрес"
            hint="Дом из справочника адресов. Показывается клиенту вместе со ссылкой на карту."
            cityId={form.cityId || null}
            value={form.address}
            onChange={(address) => set('address', address)}
          />

          <div className="grid gap-x-6 sm:grid-cols-2">
            <Field
              label="Телефон зала"
              hint="Если у зала свой администратор. Пусто — посетитель звонит в клуб."
              value={form.phone}
              onChange={(event) => set('phone', event.target.value)}
              placeholder="+79991234567"
              inputMode="tel"
            />
            <Field
              label="Почта зала"
              hint="Тоже необязательна: пусто — пишут на почту клуба."
              value={form.email}
              onChange={(event) => set('email', event.target.value)}
              placeholder="zal@example.ru"
              inputMode="email"
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

