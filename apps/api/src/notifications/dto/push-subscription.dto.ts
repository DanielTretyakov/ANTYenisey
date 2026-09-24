import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUrl, Matches, MaxLength, ValidateNested } from 'class-validator';

/** Адрес службы push: только https — на него сервер сам пойдёт запросом. */
const ENDPOINT = { protocols: ['https'], require_protocol: true, require_tld: true };

class PushKeysDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,200}$/, { message: 'Ключ p256dh — base64url' })
  p256dh!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,100}$/, { message: 'Ключ auth — base64url' })
  auth!: string;
}

/** То, что отдаёт PushSubscription.toJSON() в браузере. */
export class PushSubscriptionDto {
  @IsUrl(ENDPOINT, { message: 'Адрес подписки — https' })
  @MaxLength(1000)
  endpoint!: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;

  /**
   * Браузер кладёт его в toJSON() — обычно null. Не хранится: без него
   * подписка, отправленная целиком, упиралась бы в запрет лишних полей.
   */
  @IsOptional()
  @IsNumber()
  expirationTime?: number | null;
}

export class PushUnsubscribeDto {
  @IsUrl(ENDPOINT, { message: 'Адрес подписки — https' })
  @MaxLength(1000)
  endpoint!: string;
}
