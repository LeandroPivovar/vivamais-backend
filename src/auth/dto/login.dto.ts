import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  username: string;

  @IsString()
  @MinLength(1)
  password: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
