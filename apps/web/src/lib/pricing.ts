// Calcule le coût réel (en dollars) d'un appel à Claude Haiku 4.5, à partir
// du nombre de tokens réellement consommés (response.usage de l'API Anthropic).
// Tarifs Haiku 4.5 : 1$ / million de tokens en entrée, 5$ / million en sortie.
// C'est ce calcul qui alimente le "coût IA réel" du tableau de bord ROI —
// pas un chiffre inventé, mais dérivé de l'usage facturé à chaque appel.
const HAIKU_INPUT_PRICE_PER_TOKEN = 1 / 1_000_000;
const HAIKU_OUTPUT_PRICE_PER_TOKEN = 5 / 1_000_000;

export function computeHaikuCostUsd(usage: { input_tokens: number; output_tokens: number }): number {
  return usage.input_tokens * HAIKU_INPUT_PRICE_PER_TOKEN + usage.output_tokens * HAIKU_OUTPUT_PRICE_PER_TOKEN;
}
