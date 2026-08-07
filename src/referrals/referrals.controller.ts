import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReferralsService } from './referrals.service';
import { CreateLinkDto } from './dto/create-link.dto';
import { UpdateLinkDto } from './dto/update-link.dto';

@Controller('referrals')
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(private referralsService: ReferralsService) {}

  @Get()
  list(@CurrentUser() authUser: { id: number }) {
    return this.referralsService.listReferrals(authUser.id);
  }

  /** Árvore (hierarquia) da rede do próprio usuário — usada no modal "Ver hierarquia". */
  @Get('tree')
  tree(@CurrentUser() authUser: { id: number }) {
    return this.referralsService.getReferralTree(authUser.id);
  }

  @Get('links')
  listLinks(@CurrentUser() authUser: { id: number }) {
    return this.referralsService.listLinks(authUser.id);
  }

  /** Links fixos do usuário — um por plano (Individual, Família), criados sob demanda. */
  @Get('my-links')
  myLinks(@CurrentUser() authUser: { id: number }) {
    return this.referralsService.getOrCreatePlanLinks(authUser.id);
  }

  @Post('links')
  createLink(@CurrentUser() authUser: { id: number }, @Body() dto: CreateLinkDto) {
    return this.referralsService.createLink(authUser.id, dto);
  }

  @Put('links/:id')
  updateLink(
    @CurrentUser() authUser: { id: number },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLinkDto,
  ) {
    return this.referralsService.updateLink(authUser.id, id, dto);
  }
}
