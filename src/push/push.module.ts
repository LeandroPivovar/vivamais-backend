import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushBroadcast } from './entities/push-broadcast.entity';
import { PushDevice } from './entities/push-device.entity';
import { AdminPushController, PushController } from './push.controller';
import { PushService } from './push.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([PushDevice, PushBroadcast])],
  controllers: [PushController, AdminPushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
