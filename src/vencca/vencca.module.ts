import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { VenccaController } from './vencca.controller';
import { VenccaService } from './vencca.service';

@Module({
  imports: [UsersModule],
  controllers: [VenccaController],
  providers: [VenccaService],
  exports: [VenccaService],
})
export class VenccaModule {}
