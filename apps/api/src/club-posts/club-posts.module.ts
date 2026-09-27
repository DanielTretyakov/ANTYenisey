import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ClubPostsController, ManageClubPostsController, MyClubPostsController } from './club-posts.controller';
import { ClubPostsService } from './club-posts.service';

/** Лента клуба: акции и объявления (решение владельца от 26.09.2026). */
@Module({
  imports: [NotificationsModule],
  controllers: [ClubPostsController, ManageClubPostsController, MyClubPostsController],
  providers: [ClubPostsService],
})
export class ClubPostsModule {}
