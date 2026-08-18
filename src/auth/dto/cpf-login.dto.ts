import { Transform } from 'class-transformer';
import { IsIn, Matches } from 'class-validator';

export class CpfLoginDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value))
  @Matches(/^\d{11}$/, { message: 'CPF inválido: informe os 11 dígitos.' })
  cpf: string;

  @IsIn(['kids', 'teen'], { message: "module deve ser 'kids' ou 'teen'." })
  module: 'kids' | 'teen';
}
