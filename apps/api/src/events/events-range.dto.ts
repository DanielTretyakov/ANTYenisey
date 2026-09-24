import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Окно открытого списка мероприятий клуба: страница клуба показывает неделю
 * (решение владельца от 24.09.2026 — переключатель недели и дней). Без окна —
 * всё предстоящее, как раньше. Прошедшее не отдаётся и с окном: начало окна
 * поднимается до «сейчас».
 */
export class EventsRangeDto {
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'from — момент времени в ISO-8601' })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'to — момент времени в ISO-8601' })
  to?: string;

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
