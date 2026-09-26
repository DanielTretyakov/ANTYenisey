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
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type {
  ClosureRule,
  ClubCoach,
  ClubCoachListItem,
  ClubPeoplePage,
  ClubPerson,
  ClubSettings,
  ClubTable,
  DaySchedule,
  Hall,
  StaffPreferences,
  Tournament,
  TournamentType,
  TrainingSession,
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
  UpdateHallDto, HallManagerDto } from './dto/schedule.dto';
import {
  TournamentDto,
  TournamentTypeDto,
  TrainingSessionDto,
  TrainingTypeDto,
} from './dto/catalog.dto';
import { ChangeRolesDto, ClubPeopleQueryDto } from './dto/people.dto';
import { ClubCoachListDto } from './dto/coach-list.dto';
import { StaffPreferencesDto } from './dto/preferences.dto';
import { UpdateClubSettingsDto } from './dto/update-settings.dto';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { ClubContext } from '../auth/club-context';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { SingleFileUpload, uploadedBytes } from '../files/single-file-upload.interceptor';

/** Загрузка баннера — тот же предел, что у аватара и фото тренера. */
const UPLOAD_LIMIT = { default: { limit: 20, ttl: 60_000 } };

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
@Roles('ADMIN', 'MANAGER', 'OWNER')
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

  // --- Страница клуба: баннер и тренерский состав -------------------------

  /** Баннер — файлом в поле `file`. PUT: новый заменяет старый целиком. */
  @Throttle(UPLOAD_LIMIT)
  @Put('settings/banner')
  @UseInterceptors(SingleFileUpload)
  setBanner(@CurrentClub() club: ClubContext, @Req() request: AuthenticatedRequest): Promise<ClubSettings> {
    return this.club.setBanner(club.tenantId, uploadedBytes(request));
  }

  @Delete('settings/banner')
  removeBanner(@CurrentClub() club: ClubContext): Promise<ClubSettings> {
    return this.club.removeBanner(club.tenantId);
  }

  @Get('settings/coaches')
  coachList(@CurrentClub() club: ClubContext): Promise<ClubCoachListItem[]> {
    return this.club.listCoachList(club.tenantId);
  }

  @Put('settings/coaches')
  replaceCoachList(@CurrentClub() club: ClubContext, @Body() dto: ClubCoachListDto): Promise<ClubCoachListItem[]> {
    return this.club.replaceCoachList(club.tenantId, dto.coachIds, dto.hiddenIds, dto.coachHalls);
  }

  // --- Личные настройки сотрудника ----------------------------------------

  /**
   * Приоритетный зал того, кто спрашивает. Под теми же ролями, что смена и
   * расписание, — других экранов с выбором зала у персонала нет.
   */
  @Get('me/preferences')
  findPreferences(@CurrentClub() club: ClubContext): Promise<StaffPreferences> {
    return this.club.findPreferences(club.tenantId, club.userId);
  }

  @Put('me/preferences')
  updatePreferences(
    @CurrentClub() club: ClubContext,
    @Body() dto: StaffPreferencesDto,
  ): Promise<StaffPreferences> {
    return this.club.updatePreferences(club.tenantId, club.userId, dto.preferredHallId ?? null);
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

  /** Управляющий зала — назначает только руководитель (решение от 26.09.2026). */
  @Roles('OWNER')
  @Put('halls/:id/manager')
  setHallManager(
    @CurrentClub() club: ClubContext,
    @Param('id') hallId: string,
    @Body() dto: HallManagerDto,
  ): Promise<Hall> {
    return this.club.setHallManager(club.tenantId, hallId, dto.managerId ?? null);
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
  @Put('people/:id/roles')
  changeRole(
    @CurrentClub() club: ClubContext,
    @Param('id') userId: string,
    @Body() dto: ChangeRolesDto,
  ): Promise<ClubPerson> {
    return this.club.changeRoles(club.tenantId, club.roles, club.userId, userId, dto.roles);
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

  // --- Занятия -------------------------------------------------------------

  @Get('training-sessions')
  listTrainingSessions(@CurrentClub() club: ClubContext): Promise<TrainingSession[]> {
    return this.catalog.listTrainingSessions(club.tenantId);
  }

  @Post('training-sessions')
  createTrainingSession(
    @CurrentClub() club: ClubContext,
    @Body() dto: TrainingSessionDto,
  ): Promise<TrainingSession> {
    return this.catalog.createTrainingSession(club.tenantId, dto);
  }

  /**
   * Правка занятия. У турнира такого маршрута нет: у него нечего править,
   * кроме даты, — а у занятия есть тренер, время окончания и лимит мест, и
   * заводить занятие заново из-за смены тренера значит потерять записи.
   */
  @Patch('training-sessions/:id')
  updateTrainingSession(
    @CurrentClub() club: ClubContext,
    @Param('id') id: string,
    @Body() dto: TrainingSessionDto,
  ): Promise<TrainingSession> {
    return this.catalog.updateTrainingSession(club.tenantId, id, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('training-sessions/:id')
  deleteTrainingSession(
    @CurrentClub() club: ClubContext,
    @Param('id') id: string,
  ): Promise<void> {
    return this.catalog.deleteTrainingSession(club.tenantId, id);
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

  /**
   * Отвязка даты от шаблона: день становится копией шаблона и дальше живёт сам.
   *
   * POST, а не PUT: содержимое дня здесь не присылается и не заменяется —
   * день переводится в другое состояние. Повторный вызов отвечает тем же, что
   * первый, и ничего не заводит второй раз.
   */
  @Post('halls/:hallId/days/:date/detach')
  @HttpCode(200)
  detachDay(
    @CurrentClub() club: ClubContext,
    @Param('hallId') hallId: string,
    @Param('date') date: string,
  ): Promise<DaySchedule> {
    return this.schedule.detachDay(club.tenantId, hallId, date);
  }
}
