import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class UpsertHeirDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  cpf: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsEmail()
  email: string;
}
