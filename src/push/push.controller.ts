import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AllowKidsTeen } from '../auth/allow-kids-teen.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { BroadcastDto } from './dto/broadcast.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { PushService } from './push.service';

// Os apps Kids/Teens entram com o login CPF do dependente (token restrito): liberado aqui.
@Controller('push')
@UseGuards(JwtAuthGuard)
@AllowKidsTeen()
export class PushController {
  constructor(private push: PushService) {}

  /** O app registra o celular depois do login (e a cada abertura). */
  @Post('devices')
  @HttpCode(200)
  register(@CurrentUser() authUser: { id: number }, @Body() dto: RegisterDeviceDto) {
    return this.push.registerDevice(authUser.id, dto.token, dto.platform, dto.app);
  }

  /** Logout no app: o celular para de receber as notificações dessa conta. */
  @Delete('devices')
  unregister(@CurrentUser() authUser: { id: number }, @Body() dto: RegisterDeviceDto) {
    return this.push.unregisterDevice(authUser.id, dto.token);
  }
}

/** Painel admin: enviar notificação para todos os celulares de um app. */
@Controller('admin/push')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminPushController {
  constructor(private push: PushService) {}

  @Get()
  summary() {
    return this.push.adminSummary();
  }

  @Post('broadcast')
  @HttpCode(200)
  async broadcast(@CurrentUser() admin: { id: number }, @Body() dto: BroadcastDto) {
    try {
      return await this.push.broadcast(dto.app, dto.title.trim(), dto.body.trim(), admin?.id ?? null);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }
}
