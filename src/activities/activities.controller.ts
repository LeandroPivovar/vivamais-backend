import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ActivitiesService } from './activities.service';

@Controller('activities')
@UseGuards(JwtAuthGuard)
export class ActivitiesController {
  constructor(private activitiesService: ActivitiesService) {}

  @Get()
  list(@CurrentUser() authUser: { id: number }) {
    return this.activitiesService.list(authUser.id);
  }
}
