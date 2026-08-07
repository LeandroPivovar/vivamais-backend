import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DependentsService } from './dependents.service';
import { CreateDependentDto } from './dto/create-dependent.dto';

/** Gestão de dependentes do titular logado. */
@Controller('dependents')
@UseGuards(JwtAuthGuard)
export class DependentsController {
  constructor(private dependentsService: DependentsService) {}

  @Get()
  list(@CurrentUser() u: { id: number }) {
    return this.dependentsService.listMine(u.id);
  }

  @Post()
  create(@CurrentUser() u: { id: number }, @Body() dto: CreateDependentDto) {
    return this.dependentsService.create(u.id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: { id: number }, @Param('id', ParseIntPipe) id: number) {
    return this.dependentsService.remove(u.id, id);
  }
}
