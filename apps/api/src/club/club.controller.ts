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
  Put,
} from '@nestjs/common';
import type {
  AccessTokenPayload,
  ClosureException,
  ClosureRule,
  ClubClosures,
  ClubSettings,
  ClubTable,
} from '@yenisey/types';
import { ClosuresService } from './closures.service';
import { ClubService } from './club.service';
import { ClosureExceptionDto, ReplaceClosureRulesDto } from './dto/closures.dto';
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
  constructor(
    private readonly club: ClubService,
    private readonly closures: ClosuresService,
  ) {}

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

  // --- Закрытое время столов: недельное расписание и разовые окна.

  @Get('closures')
  findClosures(@CurrentUser() user: AccessTokenPayload): Promise<ClubClosures> {
    return this.closures.findAll(user.tenantId);
  }

  /** Замена всего расписания разом — см. ClosuresService.replaceRules. */
  @Put('closures/rules')
  replaceRules(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ReplaceClosureRulesDto,
  ): Promise<ClosureRule[]> {
    return this.closures.replaceRules(user.tenantId, dto.rules);
  }

  @Post('closures/exceptions')
  createException(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ClosureExceptionDto,
  ): Promise<ClosureException> {
    return this.closures.createException(user.tenantId, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('closures/exceptions/:id')
  deleteException(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<void> {
    return this.closures.deleteException(user.tenantId, id);
  }
}
