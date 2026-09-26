import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AccessTokenPayload, NewsFeed, NewsItem } from '@yenisey/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { NewsDraftDto, NewsQueryDto } from './dto/news.dto';
import { NewsService } from './news.service';

/**
 * Новости платформы — открытое чтение (решение владельца от 26.09.2026).
 *
 * Открытый маршрут не анонимный: предъявленный токен JwtAuthGuard всё равно
 * разбирает, и сотрудник клуба видит раздел «Для клубов».
 */
@Controller('news')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Public()
  @Get()
  feed(@Req() request: AuthenticatedRequest, @Query() query: NewsQueryDto): Promise<NewsFeed> {
    return this.news.feed(request.user?.sub ?? null, query);
  }

  @Public()
  @Get(':id')
  findOne(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<NewsItem> {
    return this.news.findOne(request.user?.sub ?? null, id);
  }
}

/**
 * Редактор новостей — только владелец платформы (`pnpm db:grant-platform`).
 * Отдельный адрес `platform/news`, а не методы записи на `news`: так
 * открытое чтение и закрытая правка не делят один контроллер с разными
 * правилами на каждом методе.
 */
@Controller('platform/news')
export class PlatformNewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  all(@CurrentUser() user: AccessTokenPayload): Promise<NewsItem[]> {
    return this.news.all(user.sub);
  }

  @Post()
  create(@CurrentUser() user: AccessTokenPayload, @Body() dto: NewsDraftDto): Promise<NewsItem> {
    return this.news.create(user.sub, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string, @Body() dto: NewsDraftDto): Promise<NewsItem> {
    return this.news.update(user.sub, id, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  remove(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string): Promise<void> {
    return this.news.remove(user.sub, id);
  }
}
