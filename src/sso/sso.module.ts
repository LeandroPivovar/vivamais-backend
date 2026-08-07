import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ActivitiesModule } from '../activities/activities.module';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';

@Module({
  imports: [
    ActivitiesModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'change-me-in-production',
    }),
  ],
  controllers: [SsoController],
  providers: [SsoService],
})
export class SsoModule {}
