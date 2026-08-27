import { Global, Module } from '@nestjs/common';
import { MassflowService } from './massflow.service';

@Global()
@Module({
  providers: [MassflowService],
  exports: [MassflowService],
})
export class MassflowModule {}
