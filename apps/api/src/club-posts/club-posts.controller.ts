import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AccessTokenPayload, ClubPost, ClubPostPage, ClubPostsUnread, ClubPostWithClub } from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { ClubPostDto, ClubPostsQueryDto, ClubPostsReadDto } from './dto/club-post.dto';
import { ClubPostsService } from './club-posts.service';

/**
 * Лента клуба — открыта без входа: блок «Новости клуба» на странице клуба.
 * Вошедшему — ещё отметки непрочитанного.
 */
@Controller('clubs/:slug/posts')
export class ClubPostsController {
  constructor(private readonly posts: ClubPostsService) {}

  @Public()
  @Get()
  feed(
    @CurrentClub() club: ClubContext,
    @Req() request: AuthenticatedRequest,
    @Query() query: ClubPostsQueryDto,
  ): Promise<ClubPostPage> {
    return this.posts.feed(club.tenantId, request.user?.sub ?? null, query);
  }

  /** Увиденное в окне новостей — прочитано. Только вошедшему. */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('read')
  read(@CurrentClub() club: ClubContext, @Body() dto: ClubPostsReadDto): Promise<void> {
    return this.posts.markRead(club.tenantId, club.userId, dto.ids);
  }

  @Public()
  @Get(':id')
  findOne(
    @CurrentClub() club: ClubContext,
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ClubPost> {
    return this.posts.findOne(club.tenantId, id, request.user?.sub ?? null);
  }
}

/**
 * Редактор ленты — руководитель, управляющий и администратор (решение
 * владельца от 26.09.2026). Роли на классе: новый маршрут окажется закрытым.
 */
@Roles('ADMIN', 'MANAGER', 'OWNER')
@Controller('clubs/:slug/manage/posts')
export class ManageClubPostsController {
  constructor(private readonly posts: ClubPostsService) {}

  @Get()
  all(@CurrentClub() club: ClubContext): Promise<ClubPost[]> {
    return this.posts.all(club.tenantId);
  }

  /** Приветствие по умолчанию — предпросмотр и «Вернуть исходный текст». */
  @Get('welcome/default')
  welcomeDefault(@CurrentClub() club: ClubContext): Promise<{ title: string; body: string }> {
    return this.posts.welcomeDefault(club.tenantId);
  }

  @Post()
  create(@CurrentClub() club: ClubContext, @Body() dto: ClubPostDto): Promise<ClubPost> {
    return this.posts.create(club.tenantId, club.userId, dto);
  }

  @Patch(':id')
  update(@CurrentClub() club: ClubContext, @Param('id') id: string, @Body() dto: ClubPostDto): Promise<ClubPost> {
    return this.posts.update(club.tenantId, club.userId, id, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  remove(@CurrentClub() club: ClubContext, @Param('id') id: string): Promise<void> {
    return this.posts.remove(club.tenantId, id);
  }
}

/** «Из моих клубов» на стартовой: клубы, отмеченные своими, и где клиент. */
@Controller('me/club-posts')
export class MyClubPostsController {
  constructor(private readonly posts: ClubPostsService) {}

  @Get()
  mine(@CurrentUser() user: AccessTokenPayload, @Query() query: ClubPostsQueryDto): Promise<ClubPostWithClub[]> {
    return this.posts.mine(user.sub, query.limit);
  }

  /** Непрочитанное по моим клубам — счётчик в шапке и на карточках стартовой. */
  @Get('unread')
  unread(@CurrentUser() user: AccessTokenPayload): Promise<ClubPostsUnread> {
    return this.posts.unread(user.sub);
  }
}
