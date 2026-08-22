import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { AppConfig } from '../admin/entities/config.entity';
import { VenccaModule } from '../vencca/vencca.module';
import { ClubeCertoModule } from '../clube-certo/clube-certo.module';
import { DependentsController } from './dependents.controller';
import { DependentsService } from './dependents.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, AppConfig]), VenccaModule, ClubeCertoModule],
  controllers: [DependentsController],
  providers: [DependentsService],
})
export class DependentsModule {}
