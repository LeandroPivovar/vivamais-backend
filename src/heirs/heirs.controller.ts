import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpsertHeirDto } from './dto/upsert-heir.dto';
import { HeirsService } from './heirs.service';

@Controller('heirs')
@UseGuards(JwtAuthGuard)
export class HeirsController {
  constructor(private heirsService: HeirsService) {}

  @Get('me')
  getMine(@CurrentUser() user: { id: number }) {
    return this.heirsService.getMine(user.id);
  }

  @Put('me')
  upsertMine(@CurrentUser() user: { id: number }, @Body() dto: UpsertHeirDto) {
    return this.heirsService.upsertMine(user.id, dto);
  }
}
