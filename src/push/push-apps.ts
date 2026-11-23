/** Apps Android que recebem push: Viva Mais (titular), Viva Mais Kids e Viva Mais Teens. */
export const PUSH_APPS = ['vivamais', 'kids', 'teens'] as const;
export type PushApp = (typeof PUSH_APPS)[number];

export const PUSH_APP_LABELS: Record<PushApp, string> = {
  vivamais: 'Viva Mais',
  kids: 'Viva Mais Kids',
  teens: 'Viva Mais Teens',
};
