import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { IsCpf } from '../../common/cpf';
import { IsBirthDate, normalizeBirthDate } from '../../common/birth-date';

export class CreateDependentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value))
  @IsCpf()
  cpf: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  /**
   * DD/MM/AAAA — a Vencca rejeita qualquer outro formato e o ageGroup (Kids/Teens)
   * depende dele. O transform aceita o que o usuário digita ("31101988") e normaliza.
   */
  @Transform(({ value }) => normalizeBirthDate(value) ?? value)
  @IsBirthDate()
  birthDate: string;
}
