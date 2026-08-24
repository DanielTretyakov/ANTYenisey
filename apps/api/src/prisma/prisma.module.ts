import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// @Global — чтобы не импортировать PrismaModule в каждый функциональный модуль.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
