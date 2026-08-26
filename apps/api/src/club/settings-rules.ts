import type { ClubSettings, Hall } from '@yenisey/types';

/**
 * Перекрёстные проверки настроек клуба и зала.
 *
 * Вынесены отдельными чистыми функциями, а не в декораторы DTO, по двум
 * причинам. Во-первых, правка настроек частичная: форма шлёт только
 * изменённое, и проверять «цены робота заданы» можно лишь на состоянии,
 * слитом с тем, что уже лежит в базе. Во-вторых, эти же правила продублированы
 * CHECK-констрейнтами в базе, и без них API отдавал бы человеку 500 вместо
 * внятного сообщения — а разъезд двух формулировок хочется видеть в тесте.
 */

/**
 * Настоящая ли это зона IANA.
 *
 * Опечатка «Asia/Krasnayarsk» тихо сломает расчёт порога отмены, границы
 * операционного дня и то, какой дате принадлежит расписание. Поэтому
 * проверяем не формат строки, а то, что зону знает сам движок дат: список зон
 * меняется вместе с политическими решениями, и держать его копию в коде
 * бессмысленно.
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Список нарушений в настройках клуба. Пустой массив — всё в порядке.
 *
 * Возвращается именно список, а не первая ошибка: человек, заполняющий форму,
 * должен увидеть все замечания разом, а не открывать их по одному.
 */
export function clubSettingsViolations(settings: ClubSettings): string[] {
  const violations: string[] = [];

  if (!isValidTimezone(settings.timezone)) {
    violations.push(
      `Часовой пояс «${settings.timezone}» не найден. Ожидается зона IANA, например «Asia/Krasnoyarsk»`,
    );
  }

  // Напоминание обязано приходить раньше, чем система сама зафиксирует
  // неявку, — иначе эскалация теряет смысл.
  if (settings.attendanceAutoNoShowAfterMinutes <= settings.attendanceReminderAfterMinutes) {
    violations.push(
      'Автоматическая неявка должна фиксироваться позже напоминания администратору',
    );
  }

  return violations;
}

/** Список нарушений в настройках зала. */
export function hallViolations(hall: Omit<Hall, 'id'>): string[] {
  const violations: string[] = [];

  if (hall.name.trim() === '') {
    violations.push('У зала должно быть название');
  }

  // Зал с включённой опцией робота, но без цен, упрётся в NULL при первом же
  // расчёте стоимости — уже в проде и уже у клиента.
  if (hall.hasRobotOption) {
    const missing = (
      [
        ['robot30MinPrice', '30 минут'],
        ['robot60MinPrice', '60 минут'],
        ['robotExtra30MinPrice', 'каждые следующие 30 минут'],
      ] as const
    )
      .filter(([field]) => hall[field] === null)
      .map(([, label]) => label);

    if (missing.length > 0) {
      violations.push(`Опция робота включена, но не заданы цены: ${missing.join(', ')}`);
    }
  }

  return violations;
}
