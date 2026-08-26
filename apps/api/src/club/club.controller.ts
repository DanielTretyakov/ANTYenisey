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
  Query,
} from '@nestjs/common';
import type {
  AccessTokenPayload,
  ClosureRule,
  ClubCoach,
  ClubPeoplePage,
  ClubPerson,
  ClubSettings,
  ClubTable,
  DaySchedule,
  Hall,
  Tournament,
  TournamentType,
  TrainingType,
} from '@yenisey/types';
import { CatalogService } from './catalog.service';
import { ClubService } from './club.service';
import { ScheduleService } from './schedule.service';
import {
  CreateHallDto,
  CreateTableDto,
  RenameTableDto,
  ReplaceDayDto,
  ReplaceTemplateDto,
  UpdateHallDto,
} from './dto/schedule.dto';
import {
  TournamentDto,
  TournamentTypeDto,
  TrainingTypeDto,
} from './dto/catalog.dto';
import { ChangeRoleDto, ClubPeopleQueryDto } from './dto/people.dto';
import { UpdateClubSettingsDto } from './dto/update-settings.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * Профиль клуба: настройки, залы, столы и расписание.
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
    private readonly schedule: ScheduleService,
    private readonly catalog: CatalogService,
  ) {}

  // --- Настройки клуба -----------------------------------------------------

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

  // --- Залы ----------------------------------------------------------------

  @Get('halls')
  listHalls(@CurrentUser() user: AccessTokenPayload): Promise<Hall[]> {
    return this.club.listHalls(user.tenantId);
  }

  @Post('halls')
  createHall(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateHallDto,
  ): Promise<Hall> {
    return this.club.createHall(user.tenantId, dto);
  }

  @Patch('halls/:id')
  updateHall(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') hallId: string,
    @Body() dto: UpdateHallDto,
  ): Promise<Hall> {
    return this.club.updateHall(user.tenantId, hallId, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('halls/:id')
  deleteHall(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') hallId: string,
  ): Promise<void> {
    return this.club.deleteHall(user.tenantId, hallId);
  }

  // --- Столы ---------------------------------------------------------------

  @Get('tables')
  listTables(@CurrentUser() user: AccessTokenPayload): Promise<ClubTable[]> {
    return this.club.listTables(user.tenantId);
  }

  @Post('tables')
  createTable(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateTableDto,
  ): Promise<ClubTable> {
    return this.club.createTable(user.tenantId, dto.hallId, dto.label);
  }

  @Patch('tables/:id')
  renameTable(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') tableId: string,
    @Body() dto: RenameTableDto,
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

  // --- Тренеры -------------------------------------------------------------

  @Get('coaches')
  listCoaches(@CurrentUser() user: AccessTokenPayload): Promise<ClubCoach[]> {
    return this.club.listCoaches(user.tenantId);
  }

  // --- Состав клуба --------------------------------------------------------

  /** Сотрудники и клиенты одним списком, с поиском и постраничной выдачей. */
  @Get('people')
  listPeople(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ClubPeopleQueryDto,
  ): Promise<ClubPeoplePage> {
    return this.club.listPeople(user.tenantId, query);
  }

  /**
   * Смена роли: повышение клиента до тренера и обратно.
   *
   * Кто именно меняет, важно: свою собственную роль изменить нельзя, иначе
   * единственный владелец мог бы запереть клуб.
   */
  @Patch('people/:id/role')
  changeRole(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') userId: string,
    @Body() dto: ChangeRoleDto,
  ): Promise<ClubPerson> {
    return this.club.changeRole(user.tenantId, user.sub, userId, dto.role);
  }

  // --- Типы тренировок -----------------------------------------------------

  @Get('training-types')
  listTrainingTypes(@CurrentUser() user: AccessTokenPayload): Promise<TrainingType[]> {
    return this.catalog.listTrainingTypes(user.tenantId);
  }

  @Post('training-types')
  createTrainingType(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: TrainingTypeDto,
  ): Promise<TrainingType> {
    return this.catalog.createTrainingType(user.tenantId, dto);
  }

  @Patch('training-types/:id')
  updateTrainingType(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: TrainingTypeDto,
  ): Promise<TrainingType> {
    return this.catalog.updateTrainingType(user.tenantId, id, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('training-types/:id')
  deleteTrainingType(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<void> {
    return this.catalog.deleteTrainingType(user.tenantId, id);
  }

  // --- Типы турниров -------------------------------------------------------

  @Get('tournament-types')
  listTournamentTypes(@CurrentUser() user: AccessTokenPayload): Promise<TournamentType[]> {
    return this.catalog.listTournamentTypes(user.tenantId);
  }

  @Post('tournament-types')
  createTournamentType(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: TournamentTypeDto,
  ): Promise<TournamentType> {
    return this.catalog.createTournamentType(user.tenantId, dto);
  }

  @Patch('tournament-types/:id')
  updateTournamentType(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: TournamentTypeDto,
  ): Promise<TournamentType> {
    return this.catalog.updateTournamentType(user.tenantId, id, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('tournament-types/:id')
  deleteTournamentType(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<void> {
    return this.catalog.deleteTournamentType(user.tenantId, id);
  }

  // --- Турниры -------------------------------------------------------------

  @Get('tournaments')
  listTournaments(@CurrentUser() user: AccessTokenPayload): Promise<Tournament[]> {
    return this.catalog.listTournaments(user.tenantId);
  }

  @Post('tournaments')
  createTournament(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: TournamentDto,
  ): Promise<Tournament> {
    return this.catalog.createTournament(user.tenantId, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('tournaments/:id')
  deleteTournament(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<void> {
    return this.catalog.deleteTournament(user.tenantId, id);
  }

  // --- Расписание зала -----------------------------------------------------

  /** Постоянный шаблон недели: как зал живёт обычно. */
  @Get('halls/:hallId/template')
  findTemplate(
    @CurrentUser() user: AccessTokenPayload,
    @Param('hallId') hallId: string,
  ): Promise<ClosureRule[]> {
    return this.schedule.findTemplate(user.tenantId, hallId);
  }

  @Put('halls/:hallId/template')
  replaceTemplate(
    @CurrentUser() user: AccessTokenPayload,
    @Param('hallId') hallId: string,
    @Body() dto: ReplaceTemplateDto,
  ): Promise<ClosureRule[]> {
    return this.schedule.replaceTemplate(user.tenantId, hallId, dto.rules);
  }

  /** Даты, на которых расписание отличается от шаблона, — для подсветки в календаре. */
  @Get('halls/:hallId/days')
  findCustomisedDates(
    @CurrentUser() user: AccessTokenPayload,
    @Param('hallId') hallId: string,
  ): Promise<string[]> {
    return this.schedule.findCustomisedDates(user.tenantId, hallId);
  }

  @Get('halls/:hallId/days/:date')
  findDay(
    @CurrentUser() user: AccessTokenPayload,
    @Param('hallId') hallId: string,
    @Param('date') date: string,
  ): Promise<DaySchedule> {
    return this.schedule.findDay(user.tenantId, hallId, date);
  }

  @Put('halls/:hallId/days/:date')
  replaceDay(
    @CurrentUser() user: AccessTokenPayload,
    @Param('hallId') hallId: string,
    @Param('date') date: string,
    @Body() dto: ReplaceDayDto,
  ): Promise<DaySchedule> {
    return this.schedule.replaceDay(user.tenantId, hallId, date, dto.closures);
  }

  /** Возврат даты к шаблону. */
  @Delete('halls/:hallId/days/:date')
  resetDay(
    @CurrentUser() user: AccessTokenPayload,
    @Param('hallId') hallId: string,
    @Param('date') date: string,
  ): Promise<DaySchedule> {
    return this.schedule.resetDay(user.tenantId, hallId, date);
  }
}
