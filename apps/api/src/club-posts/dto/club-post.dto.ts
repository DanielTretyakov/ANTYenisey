import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { ClubPostRequest, ClubPostsReadRequest } from '@yenisey/types';

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

  /** Только у приветствия: собирать текст из данных клуба. */
  @IsOptional()
  @IsBoolean()
  auto?: boolean;
}

/** Прочитанное в окне новостей — пачкой, не больше страницы окна с запасом. */
export class ClubPostsReadDto implements ClubPostsReadRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  ids: string[];
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
