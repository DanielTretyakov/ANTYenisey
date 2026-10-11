import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ClubOpeningController, PlatformClubSetupController } from './club-setup.controller';
import { ClubSetupService } from './club-setup.service';

/** Заведение клуба владельцем платформы и его открытие (решения от 11.10.2026). */
@Module({
  imports: [BillingModule],
  controllers: [PlatformClubSetupController, ClubOpeningController],
  providers: [ClubSetupService],
})
export class ClubSetupModule {}
