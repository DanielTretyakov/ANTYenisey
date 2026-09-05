import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@yenisey/database';
import { BookingStatus } from '@yenisey/database';
import type {
  Tournament,
  TournamentRequest,
  TournamentType,
  TournamentTypeRequest,
  TrainingSession,
  TrainingSessionRequest,
  TrainingType,
  TrainingTypeRequest,
} from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Справочники клуба: типы тренировок, типы турниров и сами турниры.
 *
 * Всё это клуб ведёт сам. Тип тренировки классифицирует занятие («Общая
 * групповая», «Первая подача») и несёт цену; тип турнира — то же для турниров;
 * турнир — конкретное проведение типа в конкретный момент.
 *
 * Снятые с продажи записи не удаляются, а гасятся флагом `isActive`: на них
 * ссылаются расписание и прошедшие занятия, и удаление упёрлось бы во внешний
 * ключ. Удалить можно только то, на что ещё никто не сослался.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Типы тренировок -----------------------------------------------------

  async listTrainingTypes(tenantId: string): Promise<TrainingType[]> {
    const types = await this.prisma.trainingType.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        price: true,
        isActive: true,
        _count: { select: { closureRules: true, dayClosures: true } },
      },
      // Действующие сверху, дальше по названию: снятые с продажи нужны редко.
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    return types.map((type) => ({
      id: type.id,
      name: type.name,
      price: type.price,
      isActive: type.isActive,
      usageCount: type._count.closureRules + type._count.dayClosures,
    }));
  }

  async createTrainingType(tenantId: string, dto: TrainingTypeRequest): Promise<TrainingType> {
    const name = dto.name.trim();

    if (name === '') {
      throw new BadRequestException('У типа тренировки должно быть название');
    }

    if (await this.trainingNameTaken(tenantId, name, null)) {
      throw new ConflictException(`Тип тренировки «${name}» уже есть`);
    }

    await this.prisma.trainingType.create({
      data: { tenantId, name, price: dto.price, isActive: dto.isActive ?? true },
    });

    return this.findTrainingType(tenantId, name);
  }

  async updateTrainingType(
    tenantId: string,
    id: string,
    dto: TrainingTypeRequest,
  ): Promise<TrainingType> {
    const name = dto.name.trim();

    if (name === '') {
      throw new BadRequestException('У типа тренировки должно быть название');
    }

    if (await this.trainingNameTaken(tenantId, name, id)) {
      throw new ConflictException(`Тип тренировки «${name}» уже есть`);
    }

    // tenantId в условии обязателен, хотя id и так уникален: иначе
    // администратор одного клуба правил бы справочник другого.
    const updated = await this.prisma.trainingType.updateMany({
      where: { id, tenantId },
      data: { name, price: dto.price, ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }) },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Тип тренировки не найден');
    }

    return this.findTrainingType(tenantId, name);
  }

  async deleteTrainingType(tenantId: string, id: string): Promise<void> {
    const type = await this.prisma.trainingType.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        _count: { select: { closureRules: true, dayClosures: true, sessions: true } },
      },
    });

    if (!type) {
      throw new NotFoundException('Тип тренировки не найден');
    }

    const used = type._count.closureRules + type._count.dayClosures + type._count.sessions;

    if (used > 0) {
      throw new ConflictException(
        'На этот тип ссылается расписание — его можно только снять с продажи, но не удалить',
      );
    }

    await this.prisma.trainingType.delete({ where: { id } });
  }

  private async trainingNameTaken(
    tenantId: string,
    name: string,
    exceptId: string | null,
  ): Promise<boolean> {
    const existing = await this.prisma.trainingType.findFirst({
      where: { tenantId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });

    return existing !== null;
  }

  private async findTrainingType(tenantId: string, name: string): Promise<TrainingType> {
    const types = await this.listTrainingTypes(tenantId);
    const found = types.find((type) => type.name === name);

    if (!found) {
      throw new NotFoundException('Тип тренировки не найден');
    }

    return found;
  }

  // --- Типы турниров -------------------------------------------------------

  async listTournamentTypes(tenantId: string): Promise<TournamentType[]> {
    const types = await this.prisma.tournamentType.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        ratingLabel: true,
        price: true,
        isActive: true,
        _count: { select: { tournaments: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    return types.map((type) => ({
      id: type.id,
      name: type.name,
      ratingLabel: type.ratingLabel,
      price: type.price,
      isActive: type.isActive,
      tournamentCount: type._count.tournaments,
    }));
  }

  async createTournamentType(
    tenantId: string,
    dto: TournamentTypeRequest,
  ): Promise<TournamentType> {
    const name = dto.name.trim();

    if (name === '') {
      throw new BadRequestException('У типа турнира должно быть название');
    }

    try {
      const created = await this.prisma.tournamentType.create({
        data: {
          tenantId,
          name,
          ratingLabel: dto.ratingLabel?.trim() || null,
          price: dto.price,
          isActive: dto.isActive ?? true,
        },
        select: { id: true },
      });

      return this.findTournamentType(tenantId, created.id);
    } catch (error) {
      throw this.translateDuplicate(error, `Тип турнира «${name}» уже есть`);
    }
  }

  async updateTournamentType(
    tenantId: string,
    id: string,
    dto: TournamentTypeRequest,
  ): Promise<TournamentType> {
    const name = dto.name.trim();

    if (name === '') {
      throw new BadRequestException('У типа турнира должно быть название');
    }

    const updated = await this.prisma.tournamentType.updateMany({
      where: { id, tenantId },
      data: {
        name,
        ratingLabel: dto.ratingLabel?.trim() || null,
        price: dto.price,
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Тип турнира не найден');
    }

    return this.findTournamentType(tenantId, id);
  }

  async deleteTournamentType(tenantId: string, id: string): Promise<void> {
    const type = await this.prisma.tournamentType.findFirst({
      where: { id, tenantId },
      select: { id: true, _count: { select: { tournaments: true } } },
    });

    if (!type) {
      throw new NotFoundException('Тип турнира не найден');
    }

    if (type._count.tournaments > 0) {
      throw new ConflictException(
        'По этому типу уже заведены турниры — его можно только снять с продажи',
      );
    }

    await this.prisma.tournamentType.delete({ where: { id } });
  }

  private async findTournamentType(tenantId: string, id: string): Promise<TournamentType> {
    const found = (await this.listTournamentTypes(tenantId)).find((type) => type.id === id);

    if (!found) {
      throw new NotFoundException('Тип турнира не найден');
    }

    return found;
  }

  // --- Турниры -------------------------------------------------------------

  async listTournaments(tenantId: string): Promise<Tournament[]> {
    const tournaments = await this.prisma.tournament.findMany({
      where: { tenantId },
      select: {
        id: true,
        tournamentTypeId: true,
        startsAt: true,
        tournamentType: { select: { name: true } },
        _count: { select: { dayClosures: true } },
      },
      // Ближайшие сверху: администратор заводит турнир и тут же ставит его в
      // сетку, а прошедшие нужны реже.
      orderBy: { startsAt: 'desc' },
    });

    return tournaments.map((tournament) => ({
      id: tournament.id,
      tournamentTypeId: tournament.tournamentTypeId,
      typeName: tournament.tournamentType.name,
      startsAt: tournament.startsAt.toISOString(),
      placedCount: tournament._count.dayClosures,
    }));
  }

  async createTournament(tenantId: string, dto: TournamentRequest): Promise<Tournament> {
    const startsAt = new Date(dto.startsAt);

    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('Начало турнира указывается моментом времени в ISO-8601');
    }

    const type = await this.prisma.tournamentType.findFirst({
      where: { id: dto.tournamentTypeId, tenantId },
      select: { id: true, isActive: true },
    });

    if (!type) {
      throw new NotFoundException('Тип турнира не найден');
    }

    if (!type.isActive) {
      throw new ConflictException('Этот тип турнира снят с продажи');
    }

    const created = await this.prisma.tournament.create({
      data: { tenantId, tournamentTypeId: type.id, startsAt },
      select: { id: true },
    });

    const found = (await this.listTournaments(tenantId)).find((item) => item.id === created.id);

    if (!found) {
      throw new NotFoundException('Турнир не найден');
    }

    return found;
  }

  /**
   * Удаление турнира.
   *
   * Турнир, уже стоящий в сетке, удалить нельзя: внешний ключ на `Restrict`, и
   * молча вынести вместе с ним куски расписания было бы хуже, чем отказать.
   * Сначала администратор убирает его из сетки — тогда он видит, что теряет.
   */
  async deleteTournament(tenantId: string, id: string): Promise<void> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { id, tenantId },
      select: { id: true, _count: { select: { dayClosures: true, registrations: true } } },
    });

    if (!tournament) {
      throw new NotFoundException('Турнир не найден');
    }

    if (tournament._count.dayClosures > 0) {
      throw new ConflictException('Турнир стоит в расписании — сначала уберите его из сетки');
    }

    if (tournament._count.registrations > 0) {
      throw new ConflictException('На турнир уже записались — удалить его нельзя');
    }

    await this.prisma.tournament.delete({ where: { id } });
  }

  // --- Занятия -------------------------------------------------------------

  async listTrainingSessions(tenantId: string): Promise<TrainingSession[]> {
    const sessions = await this.prisma.trainingSession.findMany({
      where: { tenantId },
      select: {
        id: true,
        trainingTypeId: true,
        coachId: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
        trainingType: { select: { name: true } },
        coach: { select: { membership: { select: { user: { select: { fullName: true } } } } } },
        _count: {
          select: {
            dayClosures: true,
            // Отменённые места не занимают: иначе занятие, из которого все
            // ушли, выглядело бы полным до самого начала.
            bookings: { where: { status: BookingStatus.BOOKED } },
          },
        },
      },
      // Ближайшие сверху — как у турниров: администратор заводит занятие и тут
      // же ставит его в сетку, а прошедшие нужны реже.
      orderBy: { startsAt: 'desc' },
    });

    return sessions.map((session) => ({
      id: session.id,
      trainingTypeId: session.trainingTypeId,
      typeName: session.trainingType.name,
      coachId: session.coachId,
      coachName: session.coach.membership.user.fullName,
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
      capacity: session.capacity,
      bookedCount: session._count.bookings,
      placedCount: session._count.dayClosures,
    }));
  }

  async createTrainingSession(
    tenantId: string,
    dto: TrainingSessionRequest,
  ): Promise<TrainingSession> {
    const { startsAt, endsAt } = this.sessionInterval(dto);

    const type = await this.prisma.trainingType.findFirst({
      where: { id: dto.trainingTypeId, tenantId },
      select: { id: true, isActive: true },
    });

    if (!type) {
      throw new NotFoundException('Тип тренировки не найден');
    }

    if (!type.isActive) {
      throw new ConflictException('Этот тип тренировки снят с продажи');
    }

    await this.ensureCoach(tenantId, dto.coachId);

    const created = await this.prisma.trainingSession.create({
      data: {
        tenantId,
        trainingTypeId: type.id,
        coachId: dto.coachId,
        startsAt,
        endsAt,
        capacity: dto.capacity,
      },
      select: { id: true },
    });

    return this.findTrainingSession(tenantId, created.id);
  }

  /**
   * Правка занятия.
   *
   * Лимит мест нельзя опустить ниже числа уже записавшихся: иначе занятие
   * оказалось бы переполненным задним числом, и решать, кого выгнать, стало бы
   * некому. Администратор, которому это нужно, сначала снимает записи.
   */
  async updateTrainingSession(
    tenantId: string,
    id: string,
    dto: TrainingSessionRequest,
  ): Promise<TrainingSession> {
    const { startsAt, endsAt } = this.sessionInterval(dto);

    const session = await this.prisma.trainingSession.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        _count: { select: { bookings: { where: { status: BookingStatus.BOOKED } } } },
      },
    });

    if (!session) {
      throw new NotFoundException('Занятие не найдено');
    }

    if (dto.capacity < session._count.bookings) {
      throw new ConflictException(
        `На занятие уже записались ${session._count.bookings} человек — мест не может быть меньше`,
      );
    }

    const type = await this.prisma.trainingType.findFirst({
      where: { id: dto.trainingTypeId, tenantId },
      select: { id: true },
    });

    if (!type) {
      throw new NotFoundException('Тип тренировки не найден');
    }

    await this.ensureCoach(tenantId, dto.coachId);

    await this.prisma.trainingSession.update({
      where: { id: session.id },
      data: {
        trainingTypeId: type.id,
        coachId: dto.coachId,
        startsAt,
        endsAt,
        capacity: dto.capacity,
      },
    });

    return this.findTrainingSession(tenantId, session.id);
  }

  /**
   * Удаление занятия — теми же правилами, что у турнира.
   *
   * Занятие, стоящее в расписании, удалить нельзя: внешний ключ на `Restrict`,
   * и молча вынести вместе с ним куски расписания хуже, чем отказать.
   */
  async deleteTrainingSession(tenantId: string, id: string): Promise<void> {
    const session = await this.prisma.trainingSession.findFirst({
      where: { id, tenantId },
      select: { id: true, _count: { select: { dayClosures: true, bookings: true } } },
    });

    if (!session) {
      throw new NotFoundException('Занятие не найдено');
    }

    if (session._count.dayClosures > 0) {
      throw new ConflictException('Занятие стоит в расписании — сначала уберите его из сетки');
    }

    if (session._count.bookings > 0) {
      throw new ConflictException('На занятие уже записывались — удалить его нельзя');
    }

    await this.prisma.trainingSession.delete({ where: { id } });
  }

  /**
   * Разбор интервала занятия.
   *
   * Порядок моментов проверяется и здесь, и в базе (`TrainingSession_time_order`):
   * база держит правило, а сообщение об ошибке человеку даёт сервер — из
   * констрейнта наружу вылезла бы пятисотка.
   */
  private sessionInterval(dto: TrainingSessionRequest): { startsAt: Date; endsAt: Date } {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('Начало и конец занятия указываются моментами в ISO-8601');
    }

    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException('Занятие не может кончаться раньше, чем началось');
    }

    return { startsAt, endsAt };
  }

  /**
   * Тренер этого клуба.
   *
   * Проверяется отдельно от вставки, хотя составной внешний ключ не пропустил
   * бы и чужого: ключ отдаёт 23503 без объяснения, а администратор должен
   * понять, что выбрал человека не из своего клуба.
   */
  private async ensureCoach(tenantId: string, coachId: string): Promise<void> {
    const coach = await this.prisma.coachProfile.findFirst({
      where: { userId: coachId, tenantId },
      select: { userId: true },
    });

    if (!coach) {
      throw new NotFoundException('Тренер не найден в этом клубе');
    }
  }

  private async findTrainingSession(tenantId: string, id: string): Promise<TrainingSession> {
    const found = (await this.listTrainingSessions(tenantId)).find((item) => item.id === id);

    if (!found) {
      throw new NotFoundException('Занятие не найдено');
    }

    return found;
  }

  private translateDuplicate(error: unknown, message: string): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(message);
    }

    return error;
  }
}
