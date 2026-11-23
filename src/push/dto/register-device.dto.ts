import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDeviceDto {
  @IsString()
  @MinLength(20)
  @MaxLength(255)
  token: string;

  @IsOptional()
  @IsIn(['android', 'ios'])
  platform?: string;
}
