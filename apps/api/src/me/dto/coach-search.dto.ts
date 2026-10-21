import { IsString, MaxLength, MinLength } from 'class-validator';

/** Поиск тренера в кабинете: от двух букв ФИО. */
export class CoachSearchDto {
  @IsString()
  @MinLength(2, { message: 'Наберите хотя бы две буквы' })
  @MaxLength(100)
  query: string;
}
