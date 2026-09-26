import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeskShiftGuard } from './desk-shift.guard';
import { DeskAccessController, StaffController } from './staff.controller';
import { StaffService } from './staff.service';

/** Смены администраторов и доступ к «Смене» (решение владельца от 26.09.2026). */
@Module({
  imports: [NotificationsModule],
  controllers: [StaffController, DeskAccessController],
  providers: [StaffService, DeskShiftGuard],
  exports: [StaffService, DeskShiftGuard],
})
export class StaffModule {}
