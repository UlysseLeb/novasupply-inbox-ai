// POST /api/generate-reply
// Rôle : rédiger le brouillon de réponse au client, en se basant sur la
// classification (/classify-ticket) ET les vraies données vérifiées
// (/retrieve-context) — jamais uniquement sur ce que le client a écrit.
// Entrée : { email_subject?, email_text, classification, context? }
//   - classification : sortie de /classify-ticket (category, complexity_level, sentiment...)
//   - context : sortie de /retrieve-context (client + orders), optionnel si pas de commande concernée
// Sortie : { reply_text, suggested_actions: string[], cost_usd }
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { computeHaikuCostUsd } from "@/lib/pricing";

const client = new Anthropic();

// suggested_actions liste les actions à déclencher dans les outils internes
// (CRM, logistique...) une fois le brouillon validé par un humain — cf. le
// scénario CMD-2045 du brief ("créer un ticket, attacher le PDF, assigner...").
const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply_text: { type: "string" },
    suggested_actions: { type: "array", items: { type: "string" } },
  },
  required: ["reply_text", "suggested_actions"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `Tu rédiges des brouillons de réponse pour le service client de NovaSupply (PME B2B de matériel industriel).

Règles :
- Réponds toujours en français, ton professionnel et courtois, en vouvoyant le client.
- Base-toi UNIQUEMENT sur les données vérifiées fournies (contexte), jamais sur de simples suppositions.
- Si un écart de livraison est signalé dans le contexte, mentionne-le précisément (référence, quantité manquante).
- suggested_actions doit lister les actions internes à déclencher après validation humaine
  (ex. "créer un ticket CRM", "assigner à la logistique", "attacher le bon de commande").`;

export async function POST(request: NextRequest) {
  const { email_subject, email_text, classification, context } = await request.json();

  if (!email_text || !classification) {
    return NextResponse.json(
      { error: "email_text and classification are required" },
      { status: 400 },
    );
  }

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: REPLY_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          `Objet original : ${email_subject ?? "(sans objet)"}`,
          `Email du client : ${email_text}`,
          `Classification : ${JSON.stringify(classification)}`,
          `Contexte vérifié (vraies données NovaSupply) : ${JSON.stringify(context ?? {})}`,
        ].join("\n\n"),
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  const draft = JSON.parse(textBlock!.text);

  return NextResponse.json({ ...draft, cost_usd: computeHaikuCostUsd(response.usage) });
}
