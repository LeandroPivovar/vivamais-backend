import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PUSH_APPS, PushApp } from '../push-apps';

export class RegisterDeviceDto {
  @IsString()
  @MinLength(20)
  @MaxLength(255)
  token: string;

  @IsOptional()
  @IsIn(['android', 'ios'])
  platform?: string;

  @IsOptional()
  @IsIn(PUSH_APPS)
  app?: PushApp;
}
