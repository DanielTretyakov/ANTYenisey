import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import {
  ACHIEVEMENT_LEVELS,
  SPORT_RANK_LEVELS,
  type AchievementLevel,
  type AchievementRequest,
  type RankReviewRequest,
  type SportRankLevel,
  type UpdateEquipmentRequest,
} from '@yenisey/types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Инвентарь. Поле не прислано — не трогается; прислано пустым или null —
 * стирается. `@IsOptional` пропускает null мимо проверок, и сервис читает его
 * как «стереть».
 */
export class UpdateEquipmentDto implements UpdateEquipmentRequest {
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Основание — не длиннее 100 символов' })
  blade?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Накладка — не длиннее 100 символов' })
  forehandRubber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Накладка — не длиннее 100 символов' })
  backhandRubber?: string | null;
}

export class AchievementDto implements AchievementRequest {
  @IsString()
  @MaxLength(200, { message: 'Название — не длиннее 200 символов' })
  title: string;

  @Matches(DATE, { message: 'Дата соревнования — в виде 2025-04-12' })
  date: string;

  @IsIn(ACHIEVEMENT_LEVELS, { message: 'Неизвестный уровень соревнования' })
  level: AchievementLevel;

  @IsOptional()
  @IsInt({ message: 'Место — целым числом' })
  @Min(1, { message: 'Место — с первого' })
  @Max(10000, { message: 'Место — не дальше 10 000-го' })
  place?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Примечание — не длиннее 500 символов' })
  note?: string | null;
}

/** Пустое поле формы — то же, что не присланное. */
const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

/**
 * Разряд. Приходит формой `multipart/form-data` вместе со сканом приказа,
 * поэтому все поля — строки.
 *
 * Один запрос на всю правку: разряд, реквизиты приказа и скан меняются
 * одним действием и одним сбросом подтверждения. Скан по отдельному маршруту
 * означал бы, что между двумя запросами разряд какое-то время не обоснован.
 */
export class SetRankDto {
  @IsIn(SPORT_RANK_LEVELS, { message: 'Неизвестный разряд' })
  rank: SportRankLevel;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(50, { message: 'Номер приказа — не длиннее 50 символов' })
  orderNumber?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @Matches(DATE, { message: 'Дата приказа — в виде 2024-11-01' })
  orderDate?: string;

  /** «true» — убрать приложенный скан. Новый файл заменяет старый и без этого. */
  @IsOptional()
  @IsIn(['true', 'false'])
  removeDocument?: 'true' | 'false';
}

export class RankReviewDto implements RankReviewRequest {
  @IsIn(['VERIFIED', 'REJECTED'], { message: 'Решение — «подтвердить» или «отклонить»' })
  decision: 'VERIFIED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Причина — не длиннее 500 символов' })
  reason?: string;

  @IsISO8601({}, { message: 'Не указана версия разряда, о которой принято решение' })
  version: string;
}
