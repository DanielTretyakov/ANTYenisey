import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type {
  AccessTokenPayload,
  ClubSettings,
  ClubTable,
} from '@yenisey/types';
import { ClubService } from './club.service';
import { TableDto } from './dto/table.dto';
import { UpdateClubSettingsDto } from './dto/update-settings.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * Профиль клуба: цены, шаг бронирования, столы, правила присутствия.
 *
 * Весь раздел закрыт ролями `admin`/`owner` — на уровне контроллера, а не
 * отдельных методов: маршрут, добавленный сюда завтра, окажется закрытым по
 * умолчанию, а не открытым по забывчивости.
 *
 * Клуб берётся из access-токена, а не из адреса. Администратор физически не
 * может обратиться к чужому клубу: подставить туда чужой идентификатор
 * неоткуда.
 */
@Roles('ADMIN', 'OWNER')
@Controller('club')
export class ClubController {
  constructor(private readonly club: ClubService) {}

  @Get('settings')
  findSettings(@CurrentUser() user: AccessTokenPayload): Promise<ClubSettings> {
    return this.club.findSettings(user.tenantId);
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UpdateClubSettingsDto,
  ): Promise<ClubSettings> {
    return this.club.updateSettings(user.tenantId, dto);
  }

  @Get('tables')
  listTables(@CurrentUser() user: AccessTokenPayload): Promise<ClubTable[]> {
    return this.club.listTables(user.tenantId);
  }

  @Post('tables')
  createTable(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: TableDto,
  ): Promise<ClubTable> {
    return this.club.createTable(user.tenantId, dto.label);
  }

  @Patch('tables/:id')
  renameTable(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') tableId: string,
    @Body() dto: TableDto,
  ): Promise<ClubTable> {
    return this.club.renameTable(user.tenantId, tableId, dto.label);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('tables/:id')
  deleteTable(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') tableId: string,
  ): Promise<void> {
    return this.club.deleteTable(user.tenantId, tableId);
  }
}
