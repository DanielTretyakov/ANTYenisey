import { Controller, Get, Param, Query } from '@nestjs/common';
import type { City, ClubCard, PublicTenant } from '@yenisey/types';
import { Public } from '../auth/decorators/public.decorator';
import { SearchClubsDto } from './dto/search-clubs.dto';
import { TenantsService } from './tenants.service';

/**
 * Справочник городов платформы.
 *
 * Отдельный контроллер, а не маршрут внутри `clubs`: города — сущность
 * платформы, а не клуба, и `/api/clubs/cities` перехватывал бы `:slug` у клуба
 * с кодом «cities».
 */
@Controller('cities')
export class CitiesController {
  constructor(private readonly tenants: TenantsService) {}

  @Public()
  @Get()
  list(): Promise<City[]> {
    return this.tenants.listCities();
  }
}

@Controller('clubs')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /**
   * Поиск клубов для стартовой страницы: по названию, по городу или без
   * условий вовсе.
   *
   * Объявлен ВЫШЕ `:slug` намеренно: Nest сопоставляет маршруты в порядке
   * объявления, и у пути без параметра иначе не было бы шанса.
   */
  @Public()
  @Get()
  search(@Query() query: SearchClubsDto): Promise<ClubCard[]> {
    return this.tenants.search(query);
  }

  @Public()
  @Get(':slug')
  findOne(@Param('slug') slug: string): Promise<PublicTenant> {
    return this.tenants.findPublicBySlug(slug);
  }
}
