import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../admin/entities/config.entity';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';

@Module({
  imports: [TypeOrmModule.forFeature([AppConfig])],
  controllers: [ContentController],
  providers: [ContentService],
})
export class ContentModule {}
