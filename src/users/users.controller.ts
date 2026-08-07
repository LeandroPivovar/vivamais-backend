import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  async me(@CurrentUser() authUser: { id: number }) {
    const user = await this.usersService.findById(authUser.id);
    return this.usersService.toProfileResponse(user);
  }

  @Patch('me')
  async updateMe(@CurrentUser() authUser: { id: number }, @Body() dto: UpdateProfileDto) {
    const user = await this.usersService.updateProfile(authUser.id, dto);
    return this.usersService.toProfileResponse(user);
  }

  @Post('me/password')
  async changePassword(@CurrentUser() authUser: { id: number }, @Body() dto: ChangePasswordDto) {
    await this.usersService.changePassword(authUser.id, dto);
    return { success: true };
  }
}
