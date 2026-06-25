// POST /api/extract-document
// Rôle : lire un PDF (ex. bon de commande joint à un email) et en sortir les
// données structurées qu'il contient — sans ça, l'IA ne peut comparer "ce que
// le client dit avoir commandé" qu'avec un texte brut, pas avec de vraies données.
// Entrée : multipart/form-data avec un champ "file" (le PDF)
// Sortie : { order_number, customer, products: [{ reference, quantity }] }
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { computeHaikuCostUsd } from "@/lib/pricing";

// Même client que /classify-ticket : lit ANTHROPIC_API_KEY dans .env.local automatiquement.
const client = new Anthropic();

// Forme attendue en sortie, identique à l'exemple du bon de commande dans le brief
// (order_number, customer, products avec reference + quantity).
const ORDER_SCHEMA = {
  type: "object",
  properties: {
    order_number: { type: "string" },
    customer: { type: "string" },
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          reference: { type: "string" },
          quantity: { type: "integer" },
        },
        required: ["reference", "quantity"],
        additionalProperties: false,
      },
    },
  },
  required: ["order_number", "customer", "products"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `Tu extrais les informations d'un bon de commande NovaSupply (PME B2B de matériel industriel).
Lis le document et renvoie le numéro de commande, le nom du client, et la liste des produits commandés (référence + quantité).`;

export async function POST(request: NextRequest) {
  // multipart/form-data : on récupère le fichier PDF envoyé par le client (formulaire ou curl -F).
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "file is required (multipart/form-data)" }, { status: 400 });
  }

  // L'API Claude attend le PDF encodé en base64, sans retour à la ligne.
  const buffer = Buffer.from(await file.arrayBuffer());
  const base64Pdf = buffer.toString("base64");

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: ORDER_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64Pdf },
          },
          { type: "text", text: "Extrais les informations de ce bon de commande." },
        ],
      },
    ],
  });

  // Même logique que /classify-ticket : le JSON utile est dans le premier bloc texte.
  const textBlock = response.content.find((block) => block.type === "text");
  const extracted = JSON.parse(textBlock!.text);

  // Même logique de coût que les autres endpoints : un chiffre réel pour le
  // tableau de bord ROI, pas une estimation forfaitaire.
  return NextResponse.json({ ...extracted, cost_usd: computeHaikuCostUsd(response.usage) });
}
