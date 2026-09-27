import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { ClubPostRequest } from '@yenisey/types';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/** Публикация клуба. Границы — те же, что у CHECK `ClubPost_*_sane`. */
export class ClubPostDto implements ClubPostRequest {
  @IsString()
  @Transform(trim)
  @MinLength(1, { message: 'У публикации должен быть заголовок' })
  @MaxLength(160, { message: 'Заголовок — не длиннее 160 символов' })
  title: string;

  @IsString()
  @Transform(trim)
  @MinLength(1, { message: 'У публикации должен быть текст' })
  @MaxLength(20000, { message: 'Текст — не длиннее 20 000 символов' })
  body: string;

  @IsBoolean()
  published: boolean;
}

export class ClubPostsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
