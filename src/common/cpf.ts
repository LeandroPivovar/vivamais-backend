import { ValidationOptions, registerDecorator } from 'class-validator';

/**
 * Valida CPF pelos dígitos verificadores. Só checar "11 dígitos" deixa passar
 * CPF digitado errado, que o gateway (Woovi) rejeita depois com
 * "CPF ou CNPJ de cliente inválido" — erro que aparece só na hora de pagar.
 */
export function isValidCpf(value: string | null | undefined): boolean {
  const cpf = (value ?? '').replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  // Sequências repetidas (000..., 111...) passam no cálculo, mas não são válidas.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digitAt = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return digitAt(9) === Number(cpf[9]) && digitAt(10) === Number(cpf[10]);
}

/** @IsCpf() — usa os dígitos verificadores, não só o tamanho. */
export function IsCpf(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCpf',
      target: object.constructor,
      propertyName,
      options: { message: 'CPF inválido. Confira os números digitados.', ...validationOptions },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isValidCpf(value),
      },
    });
  };
}
