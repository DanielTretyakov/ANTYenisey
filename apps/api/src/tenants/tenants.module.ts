import { Module } from '@nestjs/common';
import { CitiesController, TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [CitiesController, TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
