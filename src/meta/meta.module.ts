import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../admin/entities/config.entity';
import { MetaCapiService } from './meta-capi.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AppConfig])],
  providers: [MetaCapiService],
  exports: [MetaCapiService],
})
export class MetaModule {}
