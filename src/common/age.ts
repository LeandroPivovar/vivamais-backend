export type AgeGroup = 'kids' | 'teen' | 'adult';

/** Idade a partir de uma data no formato DD/MM/AAAA. Retorna null se ausente/inválida. */
export function calcAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(birthDate.trim());
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const birth = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (Number.isNaN(birth.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

/** Kids: até 10 anos. Teen: 11 a 17. Adult: 18+. Null se data ausente/inválida. */
export function ageGroup(birthDate: string | null | undefined): AgeGroup | null {
  const age = calcAge(birthDate);
  if (age === null) return null;
  if (age <= 10) return 'kids';
  if (age <= 17) return 'teen';
  return 'adult';
}
