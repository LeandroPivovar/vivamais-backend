import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CreateDependentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  cpf: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  /** DD/MM/AAAA — mesmo formato do restante do sistema. */
  @IsString()
  @IsNotEmpty()
  birthDate: string;
}
