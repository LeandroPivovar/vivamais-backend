import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushDevice } from './entities/push-device.entity';
import { PushController } from './push.controller';
import { PushService } from './push.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([PushDevice])],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
