import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ChatService } from './chat.service';

@Controller('admin/chat')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminChatController {
  constructor(private chat: ChatService) {}

  @Get()
  list() {
    return this.chat.listConversations();
  }

  @Get(':id')
  async conversation(@Param('id', ParseIntPipe) id: number) {
    const conv = await this.chat.findConversation(id);
    const messages = await this.chat.messages(id);
    await this.chat.markRead(id, 'admin');
    return { conversation: await this.chat.summary(conv), messages };
  }
}
