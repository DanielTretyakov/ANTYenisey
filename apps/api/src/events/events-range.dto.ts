import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { EventKind } from '@yenisey/types';

/**
 * Окно открытого списка мероприятий клуба: страница клуба показывает неделю
 * (решение владельца от 24.09.2026 — переключатель недели и дней). Без окна —
 * всё предстоящее, как раньше. Прошедшее не отдаётся и с окном: начало окна
 * поднимается до «сейчас».
 */
const HALLS_PATTERN = /^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+){0,19}$/;
const HALLS_MESSAGE = 'halls: идентификаторы залов через запятую, не больше 20';

/**
 * Залы вкладки «Мероприятия» страницы клуба: «Ближайшее» у вида считается в
 * выбранных залах, как и список «Предстоящих» под ней (05.10.2026).
 */
export class CatalogQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(1400)
  @Matches(HALLS_PATTERN, { message: HALLS_MESSAGE })
  halls?: string;
}

export class EventsRangeDto {
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'from — момент времени в ISO-8601' })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'to — момент времени в ISO-8601' })
  to?: string;

  /**
   * Только один вид — «ближайшая детская тренировка» (решение владельца от
   * 25.09.2026). Тип без вида не принимается: у занятия и турнира
   * идентификаторы из разных таблиц.
   */
  @IsOptional()
  @IsIn(['TRAINING', 'TOURNAMENT'])
  kind?: EventKind;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  typeId?: string;

  /**
   * Залы через запятую — фильтр страницы клуба «город, внутри — зал». Пусто —
   * все залы.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1400)
  @Matches(HALLS_PATTERN, { message: HALLS_MESSAGE })
  halls?: string;

  /** Сколько ближайших отдать; без окна и с видом — «ближайшие N по всем датам». */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /**
   * За кого смотрит родитель. Разбирает его `ActingClientGuard`, здесь он
   * только объявлен: глобальный ValidationPipe с forbidNonWhitelisted иначе
   * отклонил бы запрос с `?for=` целиком.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  for?: string;
}
