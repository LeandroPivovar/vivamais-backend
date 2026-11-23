import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { PUSH_APPS, PushApp } from '../push-apps';

/** Admin: notificação para todos os celulares de um app. */
export class BroadcastDto {
  @IsIn(PUSH_APPS)
  app: PushApp;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  title: string;

  @IsString()
  @MinLength(2)
  @MaxLength(300)
  body: string;
}
