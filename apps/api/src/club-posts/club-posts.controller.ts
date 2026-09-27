import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import type { AccessTokenPayload, ClubPost, ClubPostPage, ClubPostWithClub } from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ClubPostDto, ClubPostsQueryDto } from './dto/club-post.dto';
import { ClubPostsService } from './club-posts.service';

/** Лента клуба — открыта без входа: вкладка «Новости» на странице клуба. */
@Controller('clubs/:slug/posts')
export class ClubPostsController {
  constructor(private readonly posts: ClubPostsService) {}

  @Public()
  @Get()
  feed(@CurrentClub() club: ClubContext, @Query() query: ClubPostsQueryDto): Promise<ClubPostPage> {
    return this.posts.feed(club.tenantId, query);
  }

  @Public()
  @Get(':id')
  findOne(@CurrentClub() club: ClubContext, @Param('id') id: string): Promise<ClubPost> {
    return this.posts.findOne(club.tenantId, id);
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
}
