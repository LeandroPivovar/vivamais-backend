import { AppConfig } from '../admin/entities/config.entity';

/** Preço-base mensal do plano (sem módulos adicionais). Fonte única — usado no
 * checkout, no cálculo de preço do usuário e no endpoint público de preços. */
export function basePriceForPlan(plan: string, c: AppConfig): number {
  switch (plan) {
    case 'Bronze':
      return Number(c.planBronzePrice);
    case 'Família':
      return Number(c.planFamilyPrice);
    case 'Viva Mais Premium':
      return Number(c.planPremiumPrice);
    default:
      return Number(c.planIndividualPrice);
  }
}

/** Valor MMN (base de comissão) do plano. Fonte única para todo o cálculo de rede. */
export function mmnForPlan(plan: string, c: AppConfig): number {
  switch (plan) {
    case 'Bronze':
      return Number(c.planBronzeMmn);
    case 'Família':
      return Number(c.planFamilyMmn);
    case 'Viva Mais Premium':
      return Number(c.planPremiumMmn);
    default:
      return Number(c.planIndividualMmn);
  }
}
