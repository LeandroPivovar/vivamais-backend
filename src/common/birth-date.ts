import { ValidationOptions, registerDecorator } from 'class-validator';

/**
 * Normaliza data de nascimento para DD/MM/AAAA — o formato que a Vencca exige e
 * que o resto do sistema (ageGroup, Kids/Teens) assume. Aceita o que o usuário
 * costuma digitar: "31101988", "31-10-1988", "1988-10-31", "31/10/1988".
 * Retorna null se não for uma data real.
 */
export function normalizeBirthDate(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;

  let day: number, month: number, year: number;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw); // AAAA-MM-DD (input type=date)
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const digits = raw.replace(/\D/g, '');
    if (digits.length !== 8) return null;
    [day, month, year] = [Number(digits.slice(0, 2)), Number(digits.slice(2, 4)), Number(digits.slice(4))];
  }

  if (month < 1 || month > 12 || day < 1) return null;
  // Rejeita 31/02 e afins: se a data "estourar" o mês, o Date normaliza pra frente.
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  const currentYear = new Date().getFullYear();
  if (year < 1900 || year > currentYear) return null;

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(day)}/${pad(month)}/${year}`;
}

/** @IsBirthDate() — aceita os formatos comuns, mas exige uma data real. */
export function IsBirthDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isBirthDate',
      target: object.constructor,
      propertyName,
      options: {
        message: 'Data de nascimento inválida. Use o formato DD/MM/AAAA.',
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && normalizeBirthDate(value) !== null,
      },
    });
  };
}
