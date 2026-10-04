import { Transform } from 'class-transformer';
import { Equals, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import {
  CLUB_APPLICATION_STATUSES,
  type ClubApplicationRequest,
  type ClubApplicationStatus,
  type ClubApplicationUpdate,
} from '@yenisey/types';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);

/** Пустое поле формы — «не указано»: иначе пустая строка не прошла бы проверку формата. */
const blank = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/**
 * Заявка клуба. Правила полей — те же, что держит CHECK
 * `ClubApplication_sane`; «телефон или почта» проверяет сервис.
 */
export class ClubApplicationDto implements ClubApplicationRequest {
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'contactName: как к вам обращаться — не короче 2 символов' })
  @MaxLength(100, { message: 'contactName: не длиннее 100 символов' })
  contactName: string;

  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'clubName: название клуба — не короче 2 символов' })
  @MaxLength(120, { message: 'clubName: не длиннее 120 символов' })
  clubName: string;

  @Transform(blank)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cityId?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? (value.trim() === '' ? undefined : value.replace(/[\s()-]/g, '')) : value,
  )
  @IsOptional()
  @Matches(/^\+7\d{10}$/, { message: 'phone: ожидается формат +79991234567' })
  phone?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? (value.trim() === '' ? undefined : value.trim().toLowerCase()) : value,
  )
  @IsOptional()
  @IsEmail({}, { message: 'email: некорректный адрес' })
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsInt({ message: 'halls: число залов — целое' })
  @Min(1)
  @Max(100)
  halls?: number;

  @IsOptional()
  @IsInt({ message: 'tables: число столов — целое' })
  @Min(1)
  @Max(1000)
  tables?: number;

  @Transform(blank)
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'comment: не длиннее 2000 символов' })
  comment?: string;

  /** Имя и телефон заявителя — персональные данные: без согласия не принимаем. */
  @Equals(true, { message: 'consent: нужно согласие на обработку персональных данных' })
  consent: true;

  /** Ловушка для ботов — см. `isBotSubmission`. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;
}

export class ClubApplicationUpdateDto implements ClubApplicationUpdate {
  @IsIn(CLUB_APPLICATION_STATUSES, { message: 'status: NEW, IN_PROGRESS, CONNECTED или DECLINED' })
  status: ClubApplicationStatus;

  @Transform(blank)
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'note: заметка — не длиннее 2000 символов' })
  note: string | null;
}
