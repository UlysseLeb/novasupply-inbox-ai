// POST /api/classify-ticket
// Rôle : lire un email client et décider quoi en faire.
// Entrée : { email_text, sender_email? }
// Sortie : { category, priority, complexity_level (1/2/3), sentiment, automatic_reply_allowed, confidence }
// C'est la toute première étape du workflow : avant même de chercher des infos
// ou de rédiger une réponse, on détermine le niveau de traitement nécessaire.
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

// Client Anthropic : lit automatiquement ANTHROPIC_API_KEY dans .env.local,
// pas besoin de la passer à la main (et donc pas de risque de la committer).
const client = new Anthropic();

// On force l'IA à répondre dans cette forme exacte (structured outputs) :
// ça évite d'avoir à parser un texte libre et de tomber sur du JSON cassé.
const CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string" },
    priority: { type: "string", enum: ["low", "medium", "high"] },
    complexity_level: { type: "integer", enum: [1, 2, 3] },
    sentiment: { type: "string", enum: ["neutral", "satisfied", "annoyed", "angry"] },
    automatic_reply_allowed: { type: "boolean" },
    confidence: { type: "number" },
  },
  required: [
    "category",
    "priority",
    "complexity_level",
    "sentiment",
    "automatic_reply_allowed",
    "confidence",
  ],
  additionalProperties: false,
} as const;

// Prompt système : explique à l'IA les 3 niveaux du brief NovaSupply (cf. evaluations/tickets.json)
// pour qu'elle classe les emails selon les mêmes règles que nos cas de test.
const SYSTEM_PROMPT = `Tu classifies les emails clients de NovaSupply, une PME B2B qui vend du matériel industriel.

Niveaux de complexité :
- 1 : question simple résolvable par une FAQ (mot de passe, horaires, suivi de commande...)
- 2 : nécessite un brouillon de réponse à valider par un humain (commande incomplète, erreur de facturation, demande commerciale)
- 3 : nécessite un transfert direct à un humain (menace juridique, remboursement important, client très mécontent, données insuffisantes)

automatic_reply_allowed est true UNIQUEMENT si complexity_level est 1 ET sentiment n'est pas "angry".
confidence est ta confiance (0 à 1) dans cette classification.`;

export async function POST(request: NextRequest) {
  const { email_text, sender_email } = await request.json();

  // email_text est la seule donnée vraiment indispensable : sans texte, pas de classification possible.
  if (!email_text) {
    return NextResponse.json({ error: "email_text is required" }, { status: 400 });
  }

  // On utilise Haiku 4.5 : c'est le modèle Claude le moins cher, suffisant pour
  // une classification simple (pas de raisonnement complexe nécessaire ici),
  // ce qui compte vu le volume potentiel d'emails à traiter.
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: CLASSIFICATION_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `Email de : ${sender_email ?? "expéditeur inconnu"}\n\n${email_text}`,
      },
    ],
  });

  // La réponse peut contenir plusieurs blocs (texte, réflexion...) ; avec un schéma JSON forcé,
  // le contenu utile est toujours dans le premier bloc de type "text".
  const textBlock = response.content.find((block) => block.type === "text");
  const classification = JSON.parse(textBlock!.text);

  return NextResponse.json(classification);
}
