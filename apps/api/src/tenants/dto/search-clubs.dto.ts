import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { ClubSearchQuery } from '@yenisey/types';

/**
 * Что стартовая страница спрашивает у поиска клубов.
 *
 * Оба поля необязательны: человек, только что открывший страницу, ещё ничего
 * не ввёл, и пустой запрос означает «покажи всё», а не ошибку.
 */
export class SearchClubsDto implements ClubSearchQuery {
  /** Часть названия клуба. Длина ограничена, чтобы не гонять по базе роман. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cityId?: string;
}
