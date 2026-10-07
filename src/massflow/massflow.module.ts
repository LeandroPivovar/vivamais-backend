import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../admin/entities/config.entity';
import { MassflowService } from './massflow.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AppConfig])],
  providers: [MassflowService],
  exports: [MassflowService],
})
export class MassflowModule {}
