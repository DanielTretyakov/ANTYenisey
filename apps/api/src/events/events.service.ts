import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, Prisma, Role } from '@yenisey/database';
import type { BookingEntry, ClubEvent } from '@yenisey/types';
import { cancellationPercent } from '../booking/availability';
import { EntriesService } from '../entries/entries.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Мероприятия клуба и запись на них.
 *
 * Сейчас мероприятие — это турнир. Тренировки (TrainingSession /
 * TrainingBooking) в схеме описаны, но API их пока не обслуживает: расписание
 * занятий строится отдельным заходом. Когда оно появится, оба списка ниже
 * должны научиться собирать и его — форма ответа под это уже рассчитана.
 *
 * Аренда стола мероприятием НЕ считается и в открытый список не попадает (ТЗ →
 * «Страница клуба»): к чужой броне стола нельзя присоединиться, и публичный
 * список из неё состоял бы из строк, на которые невозможно записаться. В «мои»
 * она при этом входит — это часть расписания человека.
 */
@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entries: EntriesService,
  ) {}

  /**
   * Предстоящие мероприятия клуба — открытая запись.
   *
   * `userId` пустой, когда спрашивает аноним: список открыт без входа, клуб
   * выбирают до регистрации. Тогда `registered` остаётся `null` — отвечать
   * «не записан» тому, кто просто не представился, значило бы показать ему
   * кнопку записи, ведущую на форму входа.
   */
  async listUpcoming(tenantId: string, userId: string | null): Promise<ClubEvent[]> {
    const tournaments = await this.prisma.tournament.findMany({
      where: { tenantId, startsAt: { gte: new Date() } },
      select: {
        id: true,
        startsAt: true,
        tournamentType: { select: { name: true, ratingLabel: true, price: true } },
        registrations: {
          where: { status: BookingStatus.BOOKED },
          select: { clientId: true },
        },
      },
      orderBy: { startsAt: 'asc' },
    });

    return tournaments.map((tournament) => ({
      id: tournament.id,
      title: tournament.tournamentType.name,
      ratingLabel: tournament.tournamentType.ratingLabel,
      startsAt: tournament.startsAt.toISOString(),
      price: tournament.tournamentType.price,
      registeredCount: tournament.registrations.length,
      registered: userId
        ? tournament.registrations.some((row) => row.clientId === userId)
        : null,
    }));
  }

  /** Мои мероприятия в этом клубе: записи на турниры и свои брони столов. */
  listMine(tenantId: string, userId: string): Promise<BookingEntry[]> {
    return this.entries.listForUser(userId, tenantId);
  }

  /**
   * Запись на турнир.
   *
   * Вступать в клуб заранее не нужно: записаться может любой пользователь
   * платформы, а привязка и анкета клиента заводятся первым же действием — тем
   * же приёмом, что и при первой броне стола.
   *
   * Лимита мест у турнира нет: в схеме `Tournament` несёт только дату и тип, и
   * ТЗ ограничения не требует. Число записавшихся показывается справочно.
   */
  async register(tenantId: string, userId: string, tournamentId: string): Promise<BookingEntry> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, tenantId },
      select: {
        id: true,
        startsAt: true,
        tournamentType: { select: { price: true, isActive: true } },
      },
    });

    if (!tournament) {
      throw new NotFoundException('Турнир не найден');
    }

    if (tournament.startsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Этот турнир уже начался');
    }

    if (!tournament.tournamentType.isActive) {
      throw new BadRequestException('Запись на этот турнир закрыта');
    }

    await this.ensureClientMembership(tenantId, userId);

    try {
      await this.prisma.tournamentRegistration.create({
        data: {
          tenantId,
          tournamentId: tournament.id,
          clientId: userId,
          // Копия цены на момент записи: поднятый через месяц прайс не должен
          // переписывать то, о чём клуб уже договорился с человеком.
          priceAtBooking: tournament.tournamentType.price,
        },
      });
    } catch (error) {
      // Повторную запись ловит частичный уникальный индекс из constraints.sql.
      // Частичный он намеренно: записаться заново после собственной отмены —
      // законный сценарий, и обычный UNIQUE его бы запретил.
      //
      // Ловим по КОДУ, а не по имени индекса. Prisma индексов, заведённых
      // сырым SQL, не знает и отдаёт «Unique constraint failed on the (not
      // available)» — имени в тексте нет вовсе, и проверка по нему молча
      // пропускала бы ошибку наружу пятисоткой. Приём из BookingService (там
      // ищется имя exclusion-констрейнта) здесь не работает именно поэтому.
      //
      // Код достаточно точен: на вставке регистрации других уникальных
      // ограничений нет — первичный ключ генерируется cuid'ом.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Вы уже записаны на этот турнир');
      }

      throw error;
    }

    return this.entryFor(tenantId, userId, tournament.id);
  }

  /**
   * Отмена записи на турнир.
   *
   * Процент списания фиксируется В МОМЕНТ отмены, а не считается при показе:
   * политика клуба может измениться завтра, и тогда уже закрытая запись задним
   * числом сменила бы условия. Та же механика и те же ступени, что у брони
   * стола, — иначе два способа отмены разошлись бы в деньгах.
   */
  async cancel(tenantId: string, userId: string, tournamentId: string): Promise<BookingEntry> {
    const registration = await this.prisma.tournamentRegistration.findFirst({
      where: { tenantId, tournamentId, clientId: userId },
      select: { id: true, status: true, tournament: { select: { startsAt: true } } },
    });

    if (!registration) {
      throw new NotFoundException('Запись не найдена');
    }

    if (registration.status !== BookingStatus.BOOKED) {
      throw new BadRequestException('Эту запись уже нельзя отменить');
    }

    const tiers = await this.prisma.cancellationTier.findMany({
      where: { tenantId },
      select: { minMinutesBeforeStart: true, chargePercent: true },
    });

    const minutes = Math.floor(
      (registration.tournament.startsAt.getTime() - Date.now()) / 60_000,
    );

    await this.prisma.tournamentRegistration.update({
      where: { id: registration.id },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
        chargeRatio: cancellationPercent(tiers, minutes),
      },
    });

    return this.entryFor(tenantId, userId, tournamentId);
  }

  /**
   * Заводит привязку человека к клубу и анкету клиента, если их ещё нет.
   *
   * Оба upsert'а идут одной транзакцией: привязка без анкеты — это членство,
   * которое не может ни на что записаться, и чинить его пришлось бы руками.
   *
   * Роль существующей привязки не трогаем: тренер, записавшийся на турнир, не
   * должен от этого стать клиентом.
   *
   * Дублирует `BookingService.ensureClientMembership` — сознательно, до
   * появления третьего места, где это понадобится. Оба сервиса пишут в свои
   * таблицы, и общий предок ради двух upsert'ов связал бы модуль брони с
   * модулем мероприятий без нужды.
   */
  private async ensureClientMembership(tenantId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.tenantMembership.upsert({
        where: { userId_tenantId: { userId, tenantId } },
        update: {},
        create: { userId, tenantId, role: Role.CLIENT },
      });

      await tx.clientProfile.upsert({
        where: { userId_tenantId: { userId, tenantId } },
        update: {},
        create: { userId, tenantId },
      });
    });
  }

  /**
   * Запись в том виде, в каком её показывает интерфейс.
   *
   * Собирается тем же сервисом, что и раздел «Мои записи»: если бы ответ на
   * запись строился здесь отдельно, строка после нажатия кнопки выглядела бы
   * не так, как та же строка в списке.
   */
  private async entryFor(
    tenantId: string,
    userId: string,
    tournamentId: string,
  ): Promise<BookingEntry> {
    const entries = await this.entries.listForUser(userId, tenantId);
    const entry = entries.find((row) => row.kind === 'TOURNAMENT' && row.id === tournamentId);

    if (!entry) {
      throw new NotFoundException('Запись не найдена');
    }

    return entry;
  }
}
