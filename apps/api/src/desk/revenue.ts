import type { BookingStatus, DeskMoney } from '@yenisey/types';

/**
 * Сколько клуб заработал за день — по копиям цен, а не по кассе.
 *
 * Платёжного шлюза в системе нет: модель `Payment` описана, но не пишется
 * ниоткуда. Единственный денежный след — `priceAtBooking`, копия цены на
 * момент записи. Поэтому здесь считается СТОИМОСТЬ ОКАЗАННЫХ УСЛУГ, и на
 * экране она так и подписана: назвать её выручкой значит соврать
 * администратору, который сверит цифру с ящиком в первый же вечер.
 *
 * Относительных импортов в модуле нет намеренно: тесты идут через
 * `node --test`, а он требует расширение `.ts`, которого сборка не принимает
 * (см. CLAUDE.md). Всё, что нужно, приходит аргументами.
 */

/** Одна запись в том объёме, в каком она влияет на деньги. */
export interface ChargeRow {
  /** Копия цены на момент записи, копейки. */
  price: number;
  status: BookingStatus;
  /** Процент списания по политике клуба, 0..100. Проставляется при отмене. */
  chargeRatio: number | null;
}

/**
 * Сколько начислено по одной записи.
 *
 * Отменённая запись приносит клубу ровно тот процент, который зафиксирован в
 * момент отмены: политика клуба может смениться завтра, и пересчитывать по
 * свежей значило бы задним числом изменить условия закрытой сделки.
 *
 * Неявка без проставленного процента считается полной: ТЗ списывает за неё
 * 100%. Пустой `chargeRatio` у неявки означает не «бесплатно», а «джоба
 * эскалации ещё не отработала», и обнулять здесь — терять деньги молча.
 */
export function chargeOf(row: ChargeRow): number {
  switch (row.status) {
    case 'BOOKED':
    case 'ATTENDED':
      return row.price;

    case 'NO_SHOW':
      return row.chargeRatio === null ? row.price : ratio(row.price, row.chargeRatio);

    case 'CANCELLED':
      // Отмена без процента — ранняя, по политике клуба бесплатная.
      return row.chargeRatio === null ? 0 : ratio(row.price, row.chargeRatio);
  }
}

/** Придёт ли за этой записью человек. Отменённые и неявки — не придут. */
function expected(row: ChargeRow): boolean {
  return row.status === 'BOOKED' || row.status === 'ATTENDED';
}

/**
 * Итог дня с разбивкой по видам услуг.
 *
 * Разбивка важнее итога: сам по себе итог не объясняет ничего, а «турниров на
 * 12 000» объясняет, почему день выглядит именно так.
 */
export function moneyOf(rows: {
  tables: readonly ChargeRow[];
  trainings: readonly ChargeRow[];
  tournaments: readonly ChargeRow[];
}): DeskMoney {
  const tables = sum(rows.tables);
  const trainings = sum(rows.trainings);
  const tournaments = sum(rows.tournaments);
  const all = [...rows.tables, ...rows.trainings, ...rows.tournaments];

  return {
    tables,
    trainings,
    tournaments,
    total: tables + trainings + tournaments,
    count: all.filter(expected).length,
    cancelled: all
      .filter((row) => row.status === 'CANCELLED')
      .reduce((total, row) => total + chargeOf(row), 0),
  };
}

function sum(rows: readonly ChargeRow[]): number {
  return rows.reduce((total, row) => total + chargeOf(row), 0);
}

/**
 * Процент от суммы в копейках.
 *
 * Округление до целой копейки обязательно: деньги в схеме — целые числа, и
 * дробь, попавшая в сумму, разошлась бы с тем, что потом спишет шлюз.
 */
function ratio(price: number, percent: number): number {
  return Math.round((price * percent) / 100);
}
