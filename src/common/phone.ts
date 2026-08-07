/** Só os dígitos de uma string. */
export function onlyDigits(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

/**
 * Normaliza telefone brasileiro para o formato que o gateway Veenca aceita:
 * DDD + número (10 ou 11 dígitos), sem código do país.
 * Retorna null se não der pra formar um telefone válido (ex.: vazio ou curto demais).
 */
export function formatBrazilPhone(raw: string | null | undefined): string | null {
  let d = onlyDigits(raw);
  // Remove código do país (+55) se presente.
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
}
