import { IsBoolean } from 'class-validator';

export class SetCategoryDto {
  @IsBoolean()
  enabled!: boolean;
}
