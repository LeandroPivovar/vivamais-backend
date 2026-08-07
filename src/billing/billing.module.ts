import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from './entities/transaction.entity';
import { AppConfig } from '../admin/entities/config.entity';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { VenccaModule } from '../vencca/vencca.module';
import { PaymentModule } from '../payment/payment.module';
import { ClubeCertoModule } from '../clube-certo/clube-certo.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [TypeOrmModule.forFeature([Transaction, AppConfig, User]), UsersModule, ReferralsModule, VenccaModule, PaymentModule, ClubeCertoModule],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
