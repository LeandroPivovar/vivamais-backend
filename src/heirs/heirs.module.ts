import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Heir } from './entities/heir.entity';
import { HeirsController } from './heirs.controller';
import { HeirsService } from './heirs.service';

@Module({
  imports: [TypeOrmModule.forFeature([Heir, User])],
  controllers: [HeirsController],
  providers: [HeirsService],
})
export class HeirsModule {}
