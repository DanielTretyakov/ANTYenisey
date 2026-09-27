import { Module } from '@nestjs/common';
import { CoachStudentsController, SparringTypesController } from './sparring.controller';
import { SparringService } from './sparring.service';

/** Типы спаррингов и ученик для спарринга (решение владельца от 26.09.2026). */
@Module({
  controllers: [SparringTypesController, CoachStudentsController],
  providers: [SparringService],
})
export class SparringModule {}
