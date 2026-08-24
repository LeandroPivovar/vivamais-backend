import { Type, Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { IsCpf } from '../../common/cpf';
import { IsBirthDate, normalizeBirthDate } from '../../common/birth-date';
import { AccessDto } from './access.dto';

export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  // Normaliza para 11 dígitos e valida (evita CPF formatado/inválido no banco).
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value))
  @IsCpf()
  cpf: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  /** DD/MM/AAAA — mesmo formato exigido pela Vencca. */
  @Transform(({ value }) => normalizeBirthDate(value) ?? value)
  @IsBirthDate()
  birthDate: string;

  @IsIn(['MASCULINO', 'FEMININO'])
  gender: string;

  @IsString()
  address: string;

  @IsString()
  neighborhood: string;

  @IsOptional()
  @IsString()
  complement?: string;

  @IsString()
  city: string;

  @IsString()
  state: string;

  @IsString()
  zipCode: string;

  @IsIn(['Individual', 'Família', 'Viva Mais Premium'])
  plan: string;

  @IsIn(['Sem Nível (Diretor)', '1º Nível', '2º Nível', '3º Nível', '4º Nível', '5º Nível'])
  level: string;

  @IsOptional()
  @IsString()
  referredBy?: string;

  @ValidateNested()
  @Type(() => AccessDto)
  access: AccessDto;

  @IsIn(['ativo', 'pendente', 'inativo'])
  status: string;
}
