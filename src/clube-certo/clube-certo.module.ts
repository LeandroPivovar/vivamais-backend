import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../admin/entities/config.entity';
import { UsersModule } from '../users/users.module';
import { ClubeCertoService } from './clube-certo.service';
import { ClubeCertoController } from './clube-certo.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AppConfig]), UsersModule],
  controllers: [ClubeCertoController],
  providers: [ClubeCertoService],
  exports: [ClubeCertoService],
})
export class ClubeCertoModule {}
