import { Controller, Get, Param } from '@nestjs/common';
import type { PublicTenant } from '@yenisey/types';
import { Public } from '../auth/decorators/public.decorator';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Public()
  @Get(':slug')
  findOne(@Param('slug') slug: string): Promise<PublicTenant> {
    return this.tenants.findPublicBySlug(slug);
  }
}
