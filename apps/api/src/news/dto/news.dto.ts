import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { NEWS_BODY_MAX, NEWS_SECTIONS, NEWS_TITLE_MAX, type NewsDraft, type NewsSection } from '@yenisey/types';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/** Лента: раздел, сколько и «старше чего» — для «Показать ещё». */
export class NewsQueryDto {
  @IsOptional()
  @IsIn(NEWS_SECTIONS, { message: 'section: раздел — GENERAL, UPDATES или CLUBS' })
  section?: NewsSection;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsISO8601()
  before?: string;
}

/** Новость целиком — правка шлёт её всю: полей четыре, и частичная правка ничего не сберегла бы. */
export class NewsDraftDto implements NewsDraft {
  @IsIn(NEWS_SECTIONS, { message: 'section: раздел — GENERAL, UPDATES или CLUBS' })
  section: NewsSection;

  @IsString()
  @Transform(trim)
  @MinLength(1, { message: 'У новости должен быть заголовок' })
  @MaxLength(NEWS_TITLE_MAX, { message: `Заголовок — не длиннее ${NEWS_TITLE_MAX} символов` })
  title: string;

  @IsString()
  @Transform(trim)
  @MinLength(1, { message: 'У новости должен быть текст' })
  @MaxLength(NEWS_BODY_MAX, { message: `Текст — не длиннее ${NEWS_BODY_MAX} символов` })
  body: string;

  @IsBoolean()
  published: boolean;
}
