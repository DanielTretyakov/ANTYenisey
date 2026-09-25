import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, StoredFileKind } from '@yenisey/database';
import type {
  ClubCoach,
  ClubCoachListItem,
  Role as RoleName,
  ClubPeoplePage,
  ClubPeopleQuery,
  ClubPerson,
  ClubSettings,
  ClubTable,
  CreateHallRequest,
  Hall,
  StaffPreferences,
  UpdateClubSettingsRequest,
  UpdateHallRequest,
} from '@yenisey/types';
import { FileIntake } from '../files/file-intake.service';
import { FileStorage } from '../files/file-storage';
import { PrismaService } from '../prisma/prisma.service';
import { formatBirthDate } from '../auth/birth-date';
import { AddressProvider } from '../address/address.provider';
import { checkAddress } from '../address/address-rules';
import {
  clubSettingsViolations,
  hallViolations,
  parseClubValues,
  parseSocialUrl,
  readClubValues,
} from './settings-rules';

/**
 * Поля Tenant, составляющие профиль клуба. Выбираются явным списком, а не
 * целой моделью: рядом лежит служебное (id, отметки времени, связи), которое
 * администратору отдавать незачем.
 */
const SETTINGS_SELECT = {
  name: true,
  cityId: true,
  phone: true,
  email: true,
  description: true,
  values: true,
  vkUrl: true,
  maxUrl: true,
  bannerFileId: true,
  logoUrl: true,
  accentColor: true,
  // Часового пояса здесь нет: он переехал на зал (см. HALL_SELECT).
  noShowChargePercent: true,
  attendanceReminderAfterMinutes: true,
  attendanceAutoNoShowAfterMinutes: true,
  subscriptionBurnsOnNoShowOnly: true,
} as const;

const HALL_SELECT = {
  id: true,
  name: true,
  timezone: true,
  cityId: true,
  address: true,
  addressFiasId: true,
  latitude: true,
  longitude: true,
  bookingStep: true,
  tableHourPrice: true,
  tableExtra30MinPrice: true,
  hasRobotOption: true,
  robot30MinPrice: true,
  robot60MinPrice: true,
  robotExtra30MinPrice: true,
} as const;

@Injectable()
export class ClubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
    private readonly intake: FileIntake,
    private readonly addresses: AddressProvider,
  ) {}

  // --- Настройки клуба -----------------------------------------------------

  async findSettings(tenantId: string): Promise<ClubSettings> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: SETTINGS_SELECT,
    });

    if (!tenant) {
      throw new NotFoundException('Клуб не найден');
    }

    return toSettings(tenant);
  }

  /**
   * Частичная правка настроек.
   *
   * Проверять приходится слитое состояние, а не пришедшие поля: сдвинуть срок
   * напоминания одним запросом, а срок автонеявки другим — законный сценарий
   * формы, и «одно позже другого» проверяется только на объединении нового со
   * старым.
   */
  async updateSettings(
    tenantId: string,
    patch: UpdateClubSettingsRequest,
  ): Promise<ClubSettings> {
    const current = await this.findSettings(tenantId);
    const violations = clubSettingsViolations({ ...current, ...defined(patch) });

    if (violations.length > 0) {
      // Те же правила закреплены CHECK-констрейнтами в базе. Здесь они
      // повторены не ради надёжности, а ради формулировки: без этой проверки
      // администратор получил бы 500 и текст ошибки Postgres.
      throw new BadRequestException(violations);
    }

    const { values, vkUrl, maxUrl, ...rest } = patch;
    const data: Prisma.TenantUpdateInput = { ...rest };

    // Ценности и ссылки — через правила: база проверяет лишь форму, а
    // человеку нужна внятная причина отказа и нормализованная ссылка.
    if (values !== undefined) {
      const parsed = parseClubValues(values ?? []);

      if (!parsed.ok) {
        throw new BadRequestException(parsed.message);
      }

      data.values = parsed.value ? (parsed.value as unknown as Prisma.InputJsonArray) : Prisma.DbNull;
    }

    for (const [field, kind, raw] of [
      ['vkUrl', 'vk', vkUrl],
      ['maxUrl', 'max', maxUrl],
    ] as const) {
      if (raw === undefined) {
        continue;
      }

      const parsed = parseSocialUrl(kind, raw);

      if (!parsed.ok) {
        throw new BadRequestException(parsed.message);
      }

      data[field] = parsed.value;
    }

    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data,
      select: SETTINGS_SELECT,
    });

    return toSettings(tenant);
  }

  // --- Залы ----------------------------------------------------------------

  listHalls(tenantId: string): Promise<Hall[]> {
    return this.prisma.hall.findMany({
      where: { tenantId },
      select: HALL_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  async createHall(tenantId: string, dto: CreateHallRequest): Promise<Hall> {
    const violations = hallViolations(dto);

    if (violations.length > 0) {
      throw new BadRequestException(violations);
    }

    const address = await this.verifiedAddress(dto.addressFiasId, dto.cityId);

    try {
      return await this.prisma.hall.create({
        data: { ...dto, ...address, name: dto.name.trim(), tenantId },
        select: HALL_SELECT,
      });
    } catch (error) {
      throw this.translateHallError(error, dto.name);
    }
  }

  async updateHall(tenantId: string, hallId: string, patch: UpdateHallRequest): Promise<Hall> {
    const current = await this.findHall(tenantId, hallId);
    const violations = hallViolations({ ...current, ...defined(patch) });

    if (violations.length > 0) {
      throw new BadRequestException(violations);
    }

    const { addressFiasId, ...rest } = patch;
    const cityId = patch.cityId === undefined ? current.cityId : patch.cityId;
    const cityChanged = patch.cityId !== undefined && patch.cityId !== current.cityId;
    let address: Awaited<ReturnType<ClubService['verifiedAddress']>> | Record<string, never> = {};

    // Адрес перепроверяется, когда он меняется или меняется город зала: дом
    // обязан лежать в городе, по которому клуб находят в поиске. Зал, заведённый
    // до 25.09.2026 без адреса, при любой правке обязан его получить — CHECK
    // Hall_address_verified проверяет каждую обновлённую строку.
    if (addressFiasId && addressFiasId !== current.addressFiasId) {
      address = await this.verifiedAddress(addressFiasId, cityId);
    } else if (!current.addressFiasId) {
      throw new BadRequestException('Укажите адрес зала — выберите дом из подсказок');
    } else if (cityChanged) {
      address = await this.verifiedAddress(current.addressFiasId, cityId);
    }

    try {
      // tenantId в условии обязателен, хотя id и так уникален: иначе
      // администратор одного клуба правил бы зал другого, подставив чужой
      // идентификатор.
      await this.prisma.hall.updateMany({
        where: { id: hallId, tenantId },
        data: { ...rest, ...address, ...(rest.name === undefined ? {} : { name: rest.name.trim() }) },
      });
    } catch (error) {
      throw this.translateHallError(error, patch.name ?? current.name);
    }

    return this.findHall(tenantId, hallId);
  }

  /**
   * Удаление зала.
   *
   * Зал со столами удалить нельзя: за столами стоят брони и расписание, и
   * каскад унёс бы их молча. Сначала админ убирает столы — тогда он видит,
   * сколько всего теряет.
   */
  async deleteHall(tenantId: string, hallId: string): Promise<void> {
    const [hall, tables, halls] = await Promise.all([
      this.prisma.hall.findFirst({ where: { id: hallId, tenantId }, select: { id: true } }),
      this.prisma.table.count({ where: { hallId, tenantId } }),
      this.prisma.hall.count({ where: { tenantId } }),
    ]);

    if (!hall) {
      throw new NotFoundException('Зал не найден');
    }

    if (tables > 0) {
      throw new ConflictException(
        `В зале ${tables} ${plural(tables, 'стол', 'стола', 'столов')} — сначала уберите их`,
      );
    }

    // Клуб без единого зала не может ни назначить цену, ни завести стол:
    // настройки аренды живут только у зала.
    if (halls <= 1) {
      throw new ConflictException('Это единственный зал клуба, удалить его нельзя');
    }

    // Приоритетный зал сотрудников снимается той же транзакцией: ключ на зал
    // RESTRICT (SET NULL обнулил бы и tenantId привязки), и без этого зал,
    // который кто-то выбрал основным, не удалялся бы вовсе.
    await this.prisma.$transaction([
      this.prisma.tenantMembership.updateMany({
        where: { tenantId, preferredHallId: hallId },
        data: { preferredHallId: null },
      }),
      this.prisma.hall.delete({ where: { id: hallId } }),
    ]);
  }

  // --- Баннер клуба ---------------------------------------------------------

  /**
   * Новый баннер. Старый удаляется в той же транзакции — у клуба он один.
   * Файл принадлежит клубу, а не загрузившему администратору: того могут
   * уволить, а баннер останется.
   */
  async setBanner(tenantId: string, upload: Uint8Array | undefined): Promise<ClubSettings> {
    // Перекодирование — до транзакции: sharp думает сотни миллисекунд.
    const prepared = await this.intake.prepare('CLUB_BANNER', upload);

    await this.prisma.$transaction(async (tx) => {
      const file = await this.storage.save(tx, {
        ownerTenantId: tenantId,
        kind: StoredFileKind.CLUB_BANNER,
        contentType: prepared.contentType,
        data: prepared.data,
      });

      await tx.tenant.update({ where: { id: tenantId }, data: { bannerFileId: file.id } });
      await this.storage.prune(tx, { ownerTenantId: tenantId, kind: StoredFileKind.CLUB_BANNER, keepId: file.id });
    });

    return this.findSettings(tenantId);
  }

  async removeBanner(tenantId: string): Promise<ClubSettings> {
    await this.prisma.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id: tenantId }, data: { bannerFileId: null } });
      await this.storage.prune(tx, { ownerTenantId: tenantId, kind: StoredFileKind.CLUB_BANNER, keepId: null });
    });

    return this.findSettings(tenantId);
  }

  // --- Тренерский состав на странице клуба ----------------------------------

  /** Все действующие тренеры клуба; упорядоченные — первыми, по месту. */
  async listCoachList(tenantId: string): Promise<ClubCoachListItem[]> {
    const rows = await this.prisma.tenantMembership.findMany({
      where: { tenantId, role: Role.COACH, deactivatedAt: null, user: { deactivatedAt: null, anonymizedAt: null } },
      select: {
        userId: true,
        coachListOrder: true,
        coachHidden: true,
        user: { select: { fullName: true } },
        coachProfile: { select: { halls: { select: { hallId: true } } } },
      },
    });

    return rows
      .map((row) => ({
        id: row.userId,
        fullName: row.user.fullName,
        order: row.coachListOrder,
        hidden: row.coachHidden,
        hallIds: row.coachProfile?.halls.map((link) => link.hallId) ?? [],
      }))
      .sort(
        (a, b) =>
          (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
          a.fullName.localeCompare(b.fullName, 'ru'),
      );
  }

  /**
   * Новый состав целиком: присланные — по порядку наверху, скрытые — с
   * галочкой. Одной транзакцией: сначала все места и флаги снимаются, потом
   * раздаются заново, иначе перестановка двух тренеров упёрлась бы в
   * уникальность места.
   */
  async replaceCoachList(
    tenantId: string,
    coachIds: string[],
    hiddenIds: string[] = [],
    coachHalls?: { coachId: string; hallIds: string[] }[],
  ): Promise<ClubCoachListItem[]> {
    if (new Set(coachIds).size !== coachIds.length) {
      throw new BadRequestException('Тренер указан в списке дважды');
    }

    const coaches = await this.listCoachList(tenantId);
    const known = new Set(coaches.map((coach) => coach.id));

    if ([...coachIds, ...hiddenIds, ...(coachHalls ?? []).map((item) => item.coachId)].some((id) => !known.has(id))) {
      throw new BadRequestException('В списке есть человек, который не тренирует в этом клубе');
    }

    const hallIds = [...new Set((coachHalls ?? []).flatMap((item) => item.hallIds))];

    if (hallIds.length > 0) {
      const found = await this.prisma.hall.count({ where: { tenantId, id: { in: hallIds } } });

      if (found !== hallIds.length) {
        throw new BadRequestException('Среди залов тренера есть зал не из этого клуба');
      }
    }

    await this.prisma.$transaction([
      this.prisma.tenantMembership.updateMany({
        where: { tenantId, OR: [{ coachListOrder: { not: null } }, { coachHidden: true }] },
        data: { coachListOrder: null, coachHidden: false },
      }),
      this.prisma.tenantMembership.updateMany({
        where: { tenantId, role: Role.COACH, userId: { in: hiddenIds } },
        data: { coachHidden: true },
      }),
      // Залы тренеров — только тех, про кого прислано: остальных не трогаем.
      ...(coachHalls ?? []).flatMap((item) => [
        this.prisma.coachHall.deleteMany({ where: { tenantId, coachId: item.coachId } }),
        this.prisma.coachHall.createMany({
          data: [...new Set(item.hallIds)].map((hallId) => ({ tenantId, coachId: item.coachId, hallId })),
        }),
      ]),
      ...coachIds.map((userId, index) =>
        this.prisma.tenantMembership.update({
          where: { userId_tenantId: { userId, tenantId } },
          data: { coachListOrder: index + 1 },
        }),
      ),
    ]);

    return this.listCoachList(tenantId);
  }

  // --- Личные настройки сотрудника ------------------------------------------

  async findPreferences(tenantId: string, userId: string): Promise<StaffPreferences> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      select: { preferredHallId: true },
    });

    return { preferredHallId: membership?.preferredHallId ?? null };
  }

  /**
   * Приоритетный зал. Зал проверяется здесь ради внятного 404; от гонки и от
   * чужого клуба защищает составной ключ `(preferredHallId, tenantId)`.
   */
  async updatePreferences(tenantId: string, userId: string, hallId: string | null): Promise<StaffPreferences> {
    if (hallId) {
      const hall = await this.prisma.hall.findFirst({ where: { id: hallId, tenantId }, select: { id: true } });

      if (!hall) {
        throw new NotFoundException('Зал не найден');
      }
    }

    // Сюда пускают только ADMIN и OWNER — у них привязка есть всегда.
    const updated = await this.prisma.tenantMembership.updateMany({
      where: { userId, tenantId },
      data: { preferredHallId: hallId },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Привязка к клубу не найдена');
    }

    return { preferredHallId: hallId };
  }

  /**
   * Дом по коду ФИАС — заново у справочника, а не из формы: форма прислала
   * только код, и адрес с координатами берутся из ответа DaData. Иначе «ул.
   * Крутых Ключей, 777» прошла бы, подставленная в запрос руками.
   */
  private async verifiedAddress(
    fiasId: string,
    cityId: string | null,
  ): Promise<{ address: string; addressFiasId: string; latitude: number | null; longitude: number | null }> {
    const [found, city] = await Promise.all([
      this.addresses.findById(fiasId),
      cityId ? this.prisma.city.findUnique({ where: { id: cityId }, select: { name: true } }) : null,
    ]);
    const check = checkAddress(found, city?.name ?? null);

    if (!check.ok) {
      throw new BadRequestException(check.message);
    }

    return {
      address: check.address.value,
      addressFiasId: check.address.fiasId,
      latitude: check.address.latitude,
      longitude: check.address.longitude,
    };
  }

  private async findHall(tenantId: string, hallId: string): Promise<Hall> {
    const hall = await this.prisma.hall.findFirst({
      where: { id: hallId, tenantId },
      select: HALL_SELECT,
    });

    if (!hall) {
      throw new NotFoundException('Зал не найден');
    }

    return hall;
  }

  // --- Столы ---------------------------------------------------------------

  /**
   * Столы клуба в порядке зала и названия.
   *
   * Вместе с каждым столом едет число окон занятого времени: удаление стола
   * унесёт их каскадом, и администратор должен увидеть это ДО нажатия, а не
   * обнаружить пропажу расписания после.
   */
  async listTables(tenantId: string): Promise<ClubTable[]> {
    const tables = await this.prisma.table.findMany({
      where: { tenantId },
      select: {
        id: true,
        hallId: true,
        label: true,
        _count: { select: { bookings: true, closureRules: true, dayClosures: true } },
      },
      orderBy: [{ hallId: 'asc' }, { label: 'asc' }],
    });

    return tables.map((table) => ({
      id: table.id,
      hallId: table.hallId,
      label: table.label,
      hasBookings: table._count.bookings > 0,
      closureCount: table._count.closureRules + table._count.dayClosures,
    }));
  }

  async createTable(tenantId: string, hallId: string, label: string): Promise<ClubTable> {
    // Зал проверяется отдельно: составной внешний ключ не дал бы записать
    // чужой зал и сам, но отдал бы это ошибкой базы.
    await this.findHall(tenantId, hallId);

    try {
      const created = await this.prisma.table.create({
        data: { tenantId, hallId, label },
        select: { id: true, hallId: true, label: true },
      });

      return { ...created, hasBookings: false, closureCount: 0 };
    } catch (error) {
      throw this.translateTableError(error, label);
    }
  }

  async renameTable(tenantId: string, tableId: string, label: string): Promise<ClubTable> {
    const updated = await this.prisma.table
      .updateMany({ where: { id: tableId, tenantId }, data: { label } })
      .catch((error: unknown) => {
        throw this.translateTableError(error, label);
      });

    if (updated.count === 0) {
      throw new NotFoundException('Стол не найден');
    }

    const tables = await this.listTables(tenantId);
    const table = tables.find((item) => item.id === tableId);

    if (!table) {
      throw new NotFoundException('Стол не найден');
    }

    return table;
  }

  /**
   * Удаление стола.
   *
   * Стол с бронями удалить нельзя: за бронями висят платежи, нужные
   * бухгалтерии, и внешний ключ стоит на `Restrict`. Проверка здесь — ради
   * внятного ответа; последнее слово всё равно за базой, потому что между
   * проверкой и удалением бронь может появиться.
   *
   * Окна занятого времени удалению не мешают и уходят каскадом — их число
   * администратор видел в списке столов до нажатия.
   */
  async deleteTable(tenantId: string, tableId: string): Promise<void> {
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, tenantId },
      select: { id: true, _count: { select: { bookings: true } } },
    });

    if (!table) {
      throw new NotFoundException('Стол не найден');
    }

    if (table._count.bookings > 0) {
      throw new ConflictException(
        'У стола есть брони, поэтому удалить его нельзя — за бронями стоят платежи',
      );
    }

    try {
      await this.prisma.table.delete({ where: { id: tableId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException(
          'У стола есть брони, поэтому удалить его нельзя — за бронями стоят платежи',
        );
      }
      throw error;
    }
  }

  // --- Тренеры -------------------------------------------------------------

  /**
   * Тренеры клуба — для выбора при назначении тренировки.
   *
   * Отключённые и анонимизированные не показываются: назначить уволенного
   * тренера на будущее занятие нельзя, а уже назначенные записи остаются —
   * внешний ключ стоит на `Restrict`, и история не переписывается.
   */
  async listCoaches(tenantId: string): Promise<ClubCoach[]> {
    const coaches = await this.prisma.tenantMembership.findMany({
      where: {
        tenantId,
        role: Role.COACH,
        // Отключён в ЭТОМ клубе — и отдельно отключён на платформе: после
        // перехода на единый аккаунт это два разных события, и проверять надо оба.
        deactivatedAt: null,
        user: { deactivatedAt: null, anonymizedAt: null },
        coachProfile: { isNot: null },
      },
      select: {
        userId: true,
        user: { select: { fullName: true } },
        coachProfile: { select: { halls: { select: { hallId: true } } } },
      },
      orderBy: { user: { fullName: 'asc' } },
    });

    return coaches.map((coach) => ({
      id: coach.userId,
      fullName: coach.user.fullName,
      hallIds: coach.coachProfile?.halls.map((link) => link.hallId) ?? [],
    }));
  }

  // --- Состав клуба --------------------------------------------------------

  /**
   * Люди клуба: сотрудники и клиенты одним списком.
   *
   * Список неограничен — у клуба может быть несколько тысяч клиентов, — поэтому
   * ходит порциями и умеет искать. Отключённые не выпадают из него, а
   * помечаются: удаления в продукте нет, и человек остаётся нужен бухгалтерии
   * и истории визитов.
   */
  async listPeople(tenantId: string, query: ClubPeopleQuery): Promise<ClubPeoplePage> {
    const search = query.search?.trim();
    // Список строится по привязкам к клубу, а не по учётным записям: у User
    // клуба больше нет, и «люди клуба» — это ровно те, у кого есть
    // TenantMembership в нём.
    const where: Prisma.TenantMembershipWhereInput = {
      tenantId,
      // Анонимизированные скрыты: у них персональные данные затёрты по 152-ФЗ,
      // и показывать «Удалённый пользователь» в списке незачем.
      user: {
        anonymizedAt: null,
        ...(query.ids && query.ids.length > 0 ? { id: { in: query.ids } } : {}),
        ...(search
          ? {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' as const } },
                { email: { contains: search, mode: 'insensitive' as const } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      },
      ...(query.role ? { role: query.role } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.tenantMembership.findMany({
        where,
        select: {
          userId: true,
          role: true,
          createdAt: true,
          deactivatedAt: true,
          user: {
            select: {
              fullName: true,
              email: true,
              phone: true,
              birthDate: true,
            },
          },
        },
        // Сотрудники первыми, клиенты последними, внутри — по имени.
        //
        // Порядок ролей в Postgres — это порядок их объявления в enum
        // (CLIENT, ADMIN, COACH, OWNER), поэтому «сотрудники сверху» даёт
        // именно `desc`. Взаимный порядок админов и тренеров при этом
        // произволен, и выбирать между ними незачем: на вкладке «Все»
        // администратор ищет поиском, а роль целиком открывает вкладкой.
        orderBy: [{ role: 'desc' }, { user: { fullName: 'asc' } }],
        take: Math.min(query.limit ?? 50, 200),
        skip: query.offset ?? 0,
      }),
      this.prisma.tenantMembership.count({ where }),
    ]);

    return {
      items: items.map((person) => ({
        id: person.userId,
        fullName: person.user.fullName,
        email: person.user.email,
        phone: person.user.phone,
        birthDate: formatBirthDate(person.user.birthDate),
        role: person.role,
        createdAt: person.createdAt.toISOString(),
        deactivated: person.deactivatedAt !== null,
      })),
      total,
    };
  }

  /**
   * Смена роли человека.
   *
   * Повышение клиента до тренера и обратно — обычная жизнь клуба, и делать это
   * должен администратор, а не разработчик командой в консоли.
   *
   * Профили ролей при этом не удаляются, а заводятся по мере надобности:
   * тренер, разжалованный в клиенты, сохраняет карточку с достижениями, и
   * повышение обратно не начинается с чистого листа. Заодно на профили
   * ссылается расписание, и удаление упёрлось бы во внешний ключ.
   */
  async changeRole(
    tenantId: string,
    actorId: string,
    userId: string,
    role: RoleName,
  ): Promise<ClubPerson> {
    // Себе роль не меняют: единственный владелец, разжаловавший себя в
    // клиенты, запирает клуб — вернуть роль будет уже некому.
    if (actorId === userId) {
      throw new ConflictException('Свою собственную роль изменить нельзя');
    }

    // Роль меняется у ПРИВЯЗКИ, а не у человека: тот же аккаунт остаётся
    // клиентом в соседнем клубе, и трогать его администратор этого клуба
    // не вправе.
    const person = await this.prisma.tenantMembership.findFirst({
      where: { userId, tenantId, user: { anonymizedAt: null } },
      select: { role: true },
    });

    if (!person) {
      throw new NotFoundException('Человек не найден');
    }

    if (person.role === role) {
      throw new ConflictException('У человека уже эта роль');
    }

    // Последнего владельца не разжаловать: клуб без владельца остаётся без
    // того, кто может назначить нового.
    if (person.role === Role.OWNER) {
      const owners = await this.prisma.tenantMembership.count({
        where: {
          tenantId,
          role: Role.OWNER,
          deactivatedAt: null,
          user: { deactivatedAt: null, anonymizedAt: null },
        },
      });

      if (owners <= 1) {
        throw new ConflictException('Это единственное руководство клуба, роль менять нельзя');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Уходя из тренеров, человек уходит и из тренерского состава на
      // странице клуба: место в списке — только у роли COACH (CHECK), и без
      // этого база отклонила бы саму смену роли.
      await tx.tenantMembership.update({
        where: { userId_tenantId: { userId, tenantId } },
        data: { role, ...(role === Role.COACH ? {} : { coachListOrder: null, coachHidden: false }) },
      });

      // Залы тренера — тоже свойство роли: вернувшись тренером, человек
      // начинает «во всех залах», а не с прошлогодней привязкой.
      if (role !== Role.COACH) {
        await tx.coachHall.deleteMany({ where: { tenantId, coachId: userId } });
      }

      if (role === Role.COACH) {
        await tx.coachProfile.upsert({
          where: { userId_tenantId: { userId, tenantId } },
          update: {},
          create: { userId, tenantId },
        });
      }

      if (role === Role.CLIENT) {
        await tx.clientProfile.upsert({
          where: { userId_tenantId: { userId, tenantId } },
          update: {},
          create: { userId, tenantId },
        });
      }
    });

    const updated = await this.listPeople(tenantId, { ids: [userId], limit: 1 });
    const result = updated.items[0];

    if (!result) {
      throw new NotFoundException('Человек не найден');
    }

    return result;
  }

  // --- Разбор ошибок базы --------------------------------------------------

  /** P2002 — нарушение @@unique([hallId, label]): такое название уже занято. */
  private translateTableError(error: unknown, label: string): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(`Стол «${label}» в этом зале уже есть`);
    }

    return error;
  }

  private translateHallError(error: unknown, name: string): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(`Зал «${name}» в клубе уже есть`);
    }

    return error;
  }
}

/**
 * Поля, которые в правке действительно пришли.
 *
 * Класс DTO объявляет все поля, и незаданные приходят как `undefined`. При
 * слиянии `{ ...current, ...patch }` такое поле затирает текущее значение
 * пустотой — и проверка видит зал без названия там, где меняли одну цену.
 * Prisma `undefined` игнорирует сама, а вот перекрёстные правила — нет.
 */
/** Строка базы — в настройки: ценности из Json разбирает `readClubValues`. */
function toSettings<T extends { values: Prisma.JsonValue }>(row: T): Omit<T, 'values'> & { values: ReturnType<typeof readClubValues> } {
  return { ...row, values: readClubValues(row.values) };
}

function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** Русское склонение по числу: 1 стол, 2 стола, 5 столов. */
function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;

  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;

  return many;
}
