import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { PixKeyType } from '../entities/withdrawal.entity';

export class CreateWithdrawalDto {
  @IsIn(['cpf', 'email', 'telefone', 'aleatoria'], {
    message: 'Tipo de chave PIX inválido.',
  })
  pixKeyType: PixKeyType;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(3, { message: 'Informe a chave PIX.' })
  @MaxLength(140, { message: 'Chave PIX muito longa.' })
  pixKey: string;
}
