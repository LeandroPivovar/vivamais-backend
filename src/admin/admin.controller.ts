import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UsersService } from '../users/users.service';
import { AdminService } from './admin.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { UpdateUserDto } from '../users/dto/update-user.dto';
import { UpdateConfigDto } from './dto/update-config.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(
    private usersService: UsersService,
    private adminService: AdminService,
  ) {}

  @Get('users')
  async listUsers() {
    const users = await this.usersService.listAll();
    return users.map((u) => this.usersService.toAdminResponse(u));
  }

  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.adminService.createUserWithBilling(dto);
  }

  @Put('users/:id')
  async updateUser(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    const user = await this.usersService.update(id, dto);
    return this.usersService.toAdminResponse(await this.usersService.findById(user.id));
  }

  @Post('users/:id/reset-password')
  regeneratePassword(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.regeneratePassword(id);
  }

  @Delete('users/:id')
  async deleteUser(@Param('id', ParseIntPipe) id: number) {
    await this.usersService.remove(id);
    return { success: true };
  }

  @Get('config')
  getConfig() {
    return this.adminService.getConfigForAdmin();
  }

  @Put('config')
  updateConfig(@Body() dto: UpdateConfigDto) {
    return this.adminService.updateConfig(dto);
  }

  @Get('billing')
  getBilling() {
    return this.adminService.listBillingHistory();
  }

  /** Contadores de assinaturas para o painel: hoje, pendentes, canceladas, ativas. */
  @Get('subscription-stats')
  subscriptionStats() {
    return this.usersService.subscriptionStats();
  }

  /** Testa a conexão com o Clube Certo (login + lista de produtos da empresa). */
  @Get('clube-certo/test')
  testClubeCerto() {
    return this.adminService.testClubeCerto();
  }

  /** Cadastra no Clube Certo os associados já existentes na base (backfill). */
  @Post('clube-certo/backfill')
  backfillClubeCerto() {
    return this.adminService.backfillClubeCerto();
  }
}
