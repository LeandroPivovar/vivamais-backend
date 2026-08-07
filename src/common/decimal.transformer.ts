import { ValueTransformer } from 'typeorm';

/** mysql2 devolve colunas DECIMAL como string (evita perda de precisão) — sem isso, JSON.stringify
 * expõe "79.90" ao invés de 79.9 e quebra qualquer `.toFixed()`/aritmética no consumidor. */
export const DecimalTransformer: ValueTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
