import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ActivitiesModule } from '../activities/activities.module';
import { jwtSecret } from '../common/security';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';

@Module({
  imports: [
    ActivitiesModule,
    JwtModule.register({
      secret: jwtSecret(),
    }),
  ],
  controllers: [SsoController],
  providers: [SsoService],
})
export class SsoModule {}
