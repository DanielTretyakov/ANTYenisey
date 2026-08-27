import type { BookingQuote } from '@yenisey/types';

/**
 * Стоимость аренды стола.
 *
 * Прайс клуба задан ступенями («1 час — 400 ₽, далее +200 ₽ за каждые
 * 30 минут»), а шаг брони зала может быть и десятиминутным — тогда клиент
 * закажет 80 минут, которых в прайсе нет вовсе. Стык этих двух сеток и живёт
 * здесь.
 *
 * **Тарификация идёт начатыми получасами.** 80 минут аренды оплачиваются как
 * 90: час плюс начатые полчаса. Пропорциональный расчёт по минутам дал бы
 * 533,33 ₽ — цену, которой нет ни в прайсе на стене, ни в кассе, и объяснять
 * её пришлось бы администратору у каждого второго клиента.
 *
 * Минимум тарификации — час без робота и полчаса с роботом: ровно первые
 * строки прайса, ниже которых цены просто не существует.
 */

/** Полчаса — та единица, которой прайс меряет всё, что длиннее первого шага. */
export const HALF_HOUR_MINUTES = 30;

/** Цены зала — ровно те поля `Hall`, от которых зависит стоимость аренды. */
export interface HallPricing {
  tableHourPrice: number;
  tableExtra30MinPrice: number;
  hasRobotOption: boolean;
  robot30MinPrice: number | null;
  robot60MinPrice: number | null;
  robotExtra30MinPrice: number | null;
}

/**
 * Сколько получасов оплачивается: начатые считаются полными.
 *
 * Минимум отдаётся отдельным аргументом, а не зашит: без робота прайс
 * начинается с часа, с роботом — с получаса.
 */
export function billedHalfHours(durationMinutes: number, minimum: number): number {
  return Math.max(minimum, Math.ceil(durationMinutes / HALF_HOUR_MINUTES));
}

/**
 * Стоимость аренды в копейках.
 *
 * Бросает, если у зала нет цен на робота, а бронь просит его: цену в такой
 * ситуации взять неоткуда, и молча посчитать её как обычную аренду значило бы
 * отдать робота даром.
 */
export function tablePrice(
  hall: HallPricing,
  durationMinutes: number,
  withRobot: boolean,
): number {
  return withRobot ? robotPrice(hall, durationMinutes) : plainPrice(hall, durationMinutes);
}

/** Расчёт целиком: и цена, и то, за сколько минут она посчитана. */
export function quote(
  hall: HallPricing,
  durationMinutes: number,
  withRobot: boolean,
): BookingQuote {
  const halves = billedHalfHours(durationMinutes, withRobot ? 1 : 2);

  return {
    durationMinutes,
    billedMinutes: halves * HALF_HOUR_MINUTES,
    price: tablePrice(hall, durationMinutes, withRobot),
  };
}

/** Аренда без робота: первый час целиком, дальше доплата за каждые полчаса. */
function plainPrice(hall: HallPricing, durationMinutes: number): number {
  // Минимум — два получаса: короче часа прайс не тарифицирует, и получасовая
  // бронь в зале с шагом 30 минут стоит столько же, сколько часовая.
  const halves = billedHalfHours(durationMinutes, 2);

  return hall.tableHourPrice + (halves - 2) * hall.tableExtra30MinPrice;
}

/**
 * Аренда «стол + робот»: отдельная сетка цен, а не наценка поверх обычной.
 *
 * У неё свои первые две ступени (30 и 60 минут), и вывести вторую из первой
 * нельзя — 900 ₽ за час это не два раза по 600 ₽.
 */
function robotPrice(hall: HallPricing, durationMinutes: number): number {
  if (
    !hall.hasRobotOption ||
    hall.robot30MinPrice === null ||
    hall.robot60MinPrice === null ||
    hall.robotExtra30MinPrice === null
  ) {
    throw new Error('В этом зале нет аренды с роботом');
  }

  const halves = billedHalfHours(durationMinutes, 1);

  if (halves === 1) {
    return hall.robot30MinPrice;
  }

  return hall.robot60MinPrice + (halves - 2) * hall.robotExtra30MinPrice;
}
