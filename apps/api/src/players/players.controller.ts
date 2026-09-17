import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  NotFoundException,
  ForbiddenException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { PlayerProfile, PublicPlayer } from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Acting, ClientAction, type ActingClient } from '../guardianship/acting-client.guard';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { ClubContext } from '../auth/club-context';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { FileStorage } from '../files/file-storage';
import { SingleFileUpload, uploadedBytes } from '../files/single-file-upload.interceptor';
import { AchievementDto, RankReviewDto, SetRankDto, UpdateEquipmentDto } from './dto/player.dto';
import { PlayerAccess } from './player-access.service';
import { canReadFile } from './player-rules';
import { PlayersService } from './players.service';
import { RankReviewService } from './rank-review.service';

/**
 * Загрузки дороже обычного запроса: каждая — это `sharp` на сотни
 * миллисекунд процессора. Двадцати в минуту человеку хватит с запасом.
 */
const UPLOAD_LIMIT = { default: { limit: 20, ttl: 60_000 } };

/**
 * Свой профиль игрока. Клуба в адресе нет: профиль — свойство человека, а не
 * клуба. Заполняет его сам человек, а пока ему нет 16 — родитель, параметром
 * `?for=<id ребёнка>`; сам ребёнок до 16 профиль только смотрит.
 */
@Controller('me/player')
export class MePlayerController {
  constructor(private readonly players: PlayersService) {}

  @ClientAction('read')
  @Get()
  profile(@Acting() acting: ActingClient): Promise<PlayerProfile> {
    return this.players.profile(acting.userId);
  }

  /** Инвентарь: основание и две накладки. */
  @ClientAction()
  @Patch()
  updateEquipment(@Acting() acting: ActingClient, @Body() dto: UpdateEquipmentDto): Promise<PlayerProfile> {
    return this.players.updateEquipment(acting.userId, dto);
  }

  /** Аватар — файлом в поле `file`. PUT: новый заменяет старый целиком. */
  @Throttle(UPLOAD_LIMIT)
  @ClientAction()
  @Put('avatar')
  @UseInterceptors(SingleFileUpload)
  setAvatar(@Acting() acting: ActingClient, @Req() request: AuthenticatedRequest): Promise<PlayerProfile> {
    return this.players.setAvatar(acting.userId, uploadedBytes(request));
  }

  @ClientAction()
  @Delete('avatar')
  removeAvatar(@Acting() acting: ActingClient): Promise<PlayerProfile> {
    return this.players.removeAvatar(acting.userId);
  }

  @ClientAction()
  @Post('achievements')
  addAchievement(@Acting() acting: ActingClient, @Body() dto: AchievementDto): Promise<PlayerProfile> {
    return this.players.addAchievement(acting.userId, dto);
  }

  @ClientAction()
  @Patch('achievements/:id')
  updateAchievement(
    @Acting() acting: ActingClient,
    @Param('id') id: string,
    @Body() dto: AchievementDto,
  ): Promise<PlayerProfile> {
    return this.players.updateAchievement(acting.userId, id, dto);
  }

  @ClientAction()
  @Delete('achievements/:id')
  removeAchievement(@Acting() acting: ActingClient, @Param('id') id: string): Promise<PlayerProfile> {
    return this.players.removeAchievement(acting.userId, id);
  }

  /**
   * Разряд — формой `multipart/form-data`: поля разряда и приказа и,
   * необязательно, скан в поле `file`. Одна правка — один сброс подтверждения.
   */
  @Throttle(UPLOAD_LIMIT)
  @ClientAction()
  @Put('rank')
  @UseInterceptors(SingleFileUpload)
  setRank(
    @Acting() acting: ActingClient,
    @Body() dto: SetRankDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PlayerProfile> {
    return this.players.setRank(acting.userId, dto, uploadedBytes(request));
  }

  @ClientAction()
  @Delete('rank')
  removeRank(@Acting() acting: ActingClient): Promise<PlayerProfile> {
    return this.players.removeRank(acting.userId);
  }
}

/**
 * Публичная страница игрока. Открыта без входа — с шестнадцати лет; младше
 * видят только сам игрок, его родитель и администраторы его клубов.
 */
@Controller('players')
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  @Public()
  @Get(':id')
  player(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<PublicPlayer> {
    return this.players.publicProfile(id, request.user?.sub ?? null);
  }
}

/**
 * Раздача загруженных файлов.
 *
 * Здесь, а не в FilesModule: кому отдать файл, решают правила того, чей он, —
 * а файлы сейчас бывают только у игроков. Появится другой владелец — появится
 * и своя политика на вид файла.
 *
 * Открыт без входа, потому что аватар взрослого виден всем. Всё остальное
 * решает `canReadFile` по предъявленному токену, если он есть.
 */
@Controller('files')
export class PlayerFilesController {
  constructor(
    private readonly storage: FileStorage,
    private readonly access: PlayerAccess,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get(':id')
  async file(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.storage.read(id);

    const owner = file
      ? await this.prisma.user.findFirst({
          where: { id: file.ownerUserId, deactivatedAt: null, anonymizedAt: null },
          select: { id: true, birthDate: true },
        })
      : null;

    if (!file || !owner) {
      throw new NotFoundException('Файл не найден');
    }

    const viewerId = request.user?.sub ?? null;
    const allowed = canReadFile(
      file.kind,
      { ownerId: owner.id, birthDate: owner.birthDate },
      await this.access.viewerOf(viewerId, owner.id),
      new Date(),
    );

    if (!allowed) {
      throw new ForbiddenException('Этот файл вам недоступен');
    }

    // Открытый аватар кешируется: адрес файла меняется вместе с файлом, и
    // старый адрес всегда отдаёт одно и то же. Сутки, а не год: доступ к
    // файлу может закрыться — учётку отключили, — и чужой кеш не должен
    // раздавать его ещё год. Закрытое не кешируется вовсе.
    const open = file.kind === 'AVATAR' && canReadFile(
      file.kind,
      { ownerId: owner.id, birthDate: owner.birthDate },
      { viewerId: null, managesOwner: false, guardsOwner: false },
      new Date(),
    );

    response.set({
      'Content-Type': file.contentType,
      'Content-Length': String(file.size),
      // Тип объявлен нами и определён по байтам — угадывать его браузеру
      // незачем: угаданный «text/html» и есть атака.
      'X-Content-Type-Options': 'nosniff',
      // Открытый напрямую файл не исполняет ничего: ни скриптов PDF, ни
      // того, что могло пережить проверку.
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': open ? 'public, max-age=86400' : 'private, no-store',
      // Скан приказа — вложением: браузер не открывает PDF с чужими
      // паспортными данными во вкладке сам по себе.
      'Content-Disposition':
        file.kind === 'RANK_DOCUMENT' ? `attachment; filename="rank-document.${extension(file.contentType)}"` : 'inline',
    });

    response.end(Buffer.from(file.data));
  }
}

function extension(contentType: string): string {
  switch (contentType) {
    case 'application/pdf':
      return 'pdf';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}

/**
 * Решение клуба по разряду. Роли на классе: маршрут, добавленный сюда завтра,
 * окажется закрытым по умолчанию.
 */
@Roles('ADMIN', 'OWNER')
@Controller('clubs/:slug/people/:id/rank')
export class RankReviewController {
  constructor(private readonly reviews: RankReviewService) {}

  @Post('review')
  @HttpCode(200)
  review(
    @CurrentClub() club: ClubContext,
    @Param('id') playerId: string,
    @Body() dto: RankReviewDto,
    @Ip() ip: string,
  ): Promise<PlayerProfile> {
    return this.reviews.review(club.tenantId, playerId, dto, { userId: club.userId, ipAddress: ip ?? null });
  }
}
