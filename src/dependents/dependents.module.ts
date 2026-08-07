import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { AppConfig } from '../admin/entities/config.entity';
import { DependentsController } from './dependents.controller';
import { DependentsService } from './dependents.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, AppConfig])],
  controllers: [DependentsController],
  providers: [DependentsService],
})
export class DependentsModule {}
