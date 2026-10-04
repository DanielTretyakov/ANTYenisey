import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ClubApplicationsController, PlatformClubApplicationsController } from './club-applications.controller';
import { ClubApplicationsService } from './club-applications.service';

/** Заявки клубов на подключение к КНТ (решение владельца от 03.10.2026). */
@Module({
  imports: [NotificationsModule],
  controllers: [ClubApplicationsController, PlatformClubApplicationsController],
  providers: [ClubApplicationsService],
})
export class ClubApplicationsModule {}
