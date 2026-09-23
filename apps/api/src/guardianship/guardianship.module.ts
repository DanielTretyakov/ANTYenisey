import { Module } from '@nestjs/common';
import { MeChildrenController, MeGuardianshipController } from './family.controller';
import { FamilyService } from './family.service';
import { GuardianAccess } from './guardian-access.service';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Семья: родитель ведёт ребёнка младше 16. Расширение сверх ТЗ по решениям
 * владельца от 12.09 и 17.09.2026.
 *
 * `GuardianAccess` отдаётся наружу: к вопросу «ведёт ли он этого ребёнка»
 * обращаются запись за ребёнка, профиль игрока и раздача файлов.
 * `FamilyService` — ради карточки человека у стойки.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [MeChildrenController, MeGuardianshipController],
  providers: [FamilyService, GuardianAccess],
  exports: [FamilyService, GuardianAccess],
})
export class GuardianshipModule {}
