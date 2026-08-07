import { IsEmail, IsString, Length, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6)
  code: string;

  @IsString()
  @MinLength(6, { message: 'A nova senha deve ter ao menos 6 caracteres.' })
  newPassword: string;
}
