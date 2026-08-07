import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from './entities/config.entity';
import { Transaction } from '../billing/entities/transaction.entity';
import { UsersModule } from '../users/users.module';
import { VenccaModule } from '../vencca/vencca.module';
import { ClubeCertoModule } from '../clube-certo/clube-certo.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([AppConfig, Transaction]), UsersModule, VenccaModule, ClubeCertoModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
