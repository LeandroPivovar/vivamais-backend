import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { ChatController } from './chat.controller';
import { AdminChatController } from './admin-chat.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatConversation, ChatMessage]),
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'change-me-in-production',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '8h' },
    }),
  ],
  controllers: [ChatController, AdminChatController],
  providers: [ChatService, ChatGateway],
})
export class ChatModule {}
