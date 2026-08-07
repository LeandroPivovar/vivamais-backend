import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReferralLink } from './entities/referral-link.entity';
import { AppConfig } from '../admin/entities/config.entity';
import { UsersModule } from '../users/users.module';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

@Module({
  imports: [TypeOrmModule.forFeature([ReferralLink, AppConfig]), UsersModule],
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
