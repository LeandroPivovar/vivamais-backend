import { Body, Controller, Delete, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { PushService } from './push.service';

@Controller('push')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private push: PushService) {}

  /** O app registra o celular depois do login (e a cada abertura). */
  @Post('devices')
  @HttpCode(200)
  register(@CurrentUser() authUser: { id: number }, @Body() dto: RegisterDeviceDto) {
    return this.push.registerDevice(authUser.id, dto.token, dto.platform);
  }

  /** Logout no app: o celular para de receber as notificações dessa conta. */
  @Delete('devices')
  unregister(@CurrentUser() authUser: { id: number }, @Body() dto: RegisterDeviceDto) {
    return this.push.unregisterDevice(authUser.id, dto.token);
  }
}
