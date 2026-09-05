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
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { ClubContext } from '../auth/club-context';

/**
 * Профиль клуба: настройки, залы, столы и расписание.
 *
 * Весь раздел закрыт ролями `admin`/`owner` — на уровне контроллера, а не
 * отдельных методов: маршрут, добавленный сюда завтра, окажется закрытым по
 * умолчанию, а не открытым по забывчивости.
 *
 * Клуб берётся из адреса, а не из токена: аккаунт один на платформу, и
 * один человек бывает администратором двух клубов сразу. Подставить в адрес
 * чужой клуб теперь можно — и именно поэтому ClubContextGuard читает роль из
 * TenantMembership на каждый запрос: администратор «Енисея» в чужом клубе
 * окажется клиентом и получит 403 от строки @Roles ниже.
 */
@Roles('ADMIN', 'OWNER')
@Controller('clubs/:slug')
export class ClubController {
  constructor(
    private readonly club: ClubService,
    private readonly schedule: ScheduleService,
    private readonly catalog: CatalogService,
  ) {}

  // --- Настройки клуба -----------------------------------------------------

  @Get('settings')
  findSettings(@CurrentClub() club: ClubContext): Promise<ClubSettings> {
    return this.club.findSettings(club.tenantId);
  }

  @Patch('settings')
  updateSettings(
    @CurrentClub() club: ClubContext,
    @Body() dto: UpdateClubSettingsDto,
  ): Promise<ClubSettings> {
    return this.club.updateSettings(club.tenantId, dto);
  }

  // --- Залы ----------------------------------------------------------------

  @Get('halls')
  listHalls(@CurrentClub() club: ClubContext): Promise<Hall[]> {
    return this.club.listHalls(club.tenantId);
  }

  @Post('halls')
  createHall(
    @CurrentClub() club: ClubContext,
    @Body() dto: CreateHallDto,
  ): Promise<Hall> {
    return this.club.createHall(club.tenantId, dto);
  }

  @Patch('halls/:id')
  updateHall(
    @CurrentClub() club: ClubContext,
    @Param('id') hallId: string,
    @Body() dto: UpdateHallDto,
  ): Promise<Hall> {
    return this.club.updateHall(club.tenantId, hallId, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('halls/:id')
  deleteHall(
    @CurrentClub() club: ClubContext,
    @Param('id') hallId: string,
  ): Promise<void> {
    return this.club.deleteHall(club.tenantId, hallId);
  }

  // --- Столы ---------------------------------------------------------------

  @Get('tables')
  listTables(@CurrentClub() club: ClubContext): Promise<ClubTable[]> {
    return this.club.listTables(club.tenantId);
  }

  @Post('tables')
  createTable(
    @CurrentClub() club: ClubContext,
    @Body() dto: CreateTableDto,
  ): Promise<ClubTable> {
    return this.club.createTable(club.tenantId, dto.hallId, dto.label);
  }

  @Patch('tables/:id')
  renameTable(
    @CurrentClub() club: ClubContext,
    @Param('id') tableId: string,
    @Body() dto: RenameTableDto,
  ): Promise<ClubTable> {
    return this.club.renameTable(club.tenantId, tableId, dto.label);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('tables/:id')
  deleteTable(
    @CurrentClub() club: ClubContext,
    @Param('id') tableId: string,
  ): Promise<void> {
    return this.club.deleteTable(club.tenantId, tableId);
  }

  // --- Тренеры -------------------------------------------------------------

  @Get('coaches')
  listCoaches(@CurrentClub() club: ClubContext): Promise<ClubCoach[]> {
    return this.club.listCoaches(club.tenantId);
  }

  // --- Состав клуба --------------------------------------------------------

  /** Сотрудники и клиенты одним списком, с поиском и постраничной выдачей. */
  @Get('people')
  listPeople(
    @CurrentClub() club: ClubContext,
    @Query() query: ClubPeopleQueryDto,
  ): Promise<ClubPeoplePage> {
    return this.club.listPeople(club.tenantId, query);
  }

  /**
   * Смена роли: повышение клиента до тренера и обратно.
   *
   * Кто именно меняет, важно: свою собственную роль изменить нельзя, иначе
   * единственный владелец мог бы запереть клуб.
   */
  @Patch('people/:id/role')
  changeRole(
    @CurrentClub() club: ClubContext,
    @Param('id') userId: string,
    @Body() dto: ChangeRoleDto,
  ): Promise<ClubPerson> {
    return this.club.changeRole(club.tenantId, club.userId, userId, dto.role);
  }

  // --- Типы тренировок -----------------------------------------------------

  @Get('training-types')
  listTrainingTypes(@CurrentClub() club: ClubContext): Promise<TrainingType[]> {
    return this.catalog.listTrainingTypes(club.tenantId);
  }

  @Post('training-types')
  createTrainingType(
    @CurrentClub() club: ClubContext,
    @Body() dto: TrainingTypeDto,
  ): Promise<TrainingType> {
    return this.catalog.createTrainingType(club.tenantId, dto);
  }

  @Patch('training-types/:id')
  updateTrainingType(
    @CurrentClub() club: ClubContext,
    @Param('id') id: string,
    @Body() dto: TrainingTypeDto,
  ): Promise<TrainingType> {
    return this.catalog.updateTrainingType(club.tenantId, id, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('training-types/:id')
  deleteTrainingType(
    @CurrentClub() club: ClubContext,
    @Param('id') id: string,
  ): Promise<void> {
    return this.catalog.deleteTrainingType(club.tenantId, id);
  }

  // --- Типы турниров -------------------------------------------------------

  @Get('tournament-types')
  listTournamentTypes(@CurrentClub() club: ClubContext): Promise<TournamentType[]> {
    return this.catalog.listTournamentTypes(club.tenantId);
  }

  @Post('tournament-types')
  createTournamentType(
    @CurrentClub() club: ClubContext,
    @Body() dto: TournamentTypeDto,
  ): Promise<TournamentType> {
    return this.catalog.createTournamentType(club.tenantId, dto);
  }

  @Patch('tournament-types/:id')
  updateTournamentType(
    @CurrentClub() club: ClubContext,
    @Param('id') id: string,
    @Body() dto: TournamentTypeDto,
  ): Promise<TournamentType> {
    return this.catalog.updateTournamentType(club.tenantId, id, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('tournament-types/:id')
  deleteTournamentType(
    @CurrentClub() club: ClubContext,
    @Param('id') id: string,
  ): Promise<void> {
    return this.catalog.deleteTournamentType(club.tenantId, id);
  }

  // --- Турниры -------------------------------------------------------------

  @Get('tournaments')
  listTournaments(@CurrentClub() club: ClubContext): Promise<Tournament[]> {
    return this.catalog.listTournaments(club.tenantId);
  }

  @Post('tournaments')
  createTournament(
    @CurrentClub() club: ClubContext,
    @Body() dto: TournamentDto,
  ): Promise<Tournament> {
    return this.catalog.createTournament(club.tenantId, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('tournaments/:id')
  deleteTournament(
    @CurrentClub() club: ClubContext,
    @Param('id') id: string,
  ): Promise<void> {
    return this.catalog.deleteTournament(club.tenantId, id);
  }

  // --- Расписание зала -----------------------------------------------------

  /** Постоянный шаблон недели: как зал живёт обычно. */
  @Get('halls/:hallId/template')
  findTemplate(
    @CurrentClub() club: ClubContext,
    @Param('hallId') hallId: string,
  ): Promise<ClosureRule[]> {
    return this.schedule.findTemplate(club.tenantId, hallId);
  }

  @Put('halls/:hallId/template')
  replaceTemplate(
    @CurrentClub() club: ClubContext,
    @Param('hallId') hallId: string,
    @Body() dto: ReplaceTemplateDto,
  ): Promise<ClosureRule[]> {
    return this.schedule.replaceTemplate(club.tenantId, hallId, dto.rules);
  }

  /** Даты, на которых расписание отличается от шаблона, — для подсветки в календаре. */
  @Get('halls/:hallId/days')
  findCustomisedDates(
    @CurrentClub() club: ClubContext,
    @Param('hallId') hallId: string,
  ): Promise<string[]> {
    return this.schedule.findCustomisedDates(club.tenantId, hallId);
  }

  @Get('halls/:hallId/days/:date')
  findDay(
    @CurrentClub() club: ClubContext,
    @Param('hallId') hallId: string,
    @Param('date') date: string,
  ): Promise<DaySchedule> {
    return this.schedule.findDay(club.tenantId, hallId, date);
  }

  @Put('halls/:hallId/days/:date')
  replaceDay(
    @CurrentClub() club: ClubContext,
    @Param('hallId') hallId: string,
    @Param('date') date: string,
    @Body() dto: ReplaceDayDto,
  ): Promise<DaySchedule> {
    return this.schedule.replaceDay(club.tenantId, hallId, date, dto.closures);
  }

  /** Возврат даты к шаблону. */
  @Delete('halls/:hallId/days/:date')
  resetDay(
    @CurrentClub() club: ClubContext,
    @Param('hallId') hallId: string,
    @Param('date') date: string,
  ): Promise<DaySchedule> {
    return this.schedule.resetDay(club.tenantId, hallId, date);
  }
}
