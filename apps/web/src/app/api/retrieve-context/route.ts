// POST /api/retrieve-context
// Rôle : vérifier dans les vraies données de NovaSupply ce qu'il en est réellement
// (pas de confiance aveugle en ce que dit l'email ou le PDF). Permet de répondre
// avec des faits vérifiés plutôt que de répéter ce que le client a affirmé.
//
// Deux sources, chacune dans son rôle naturel :
//   - HubSpot (CRM) : qui est le client, et qu'est-ce qu'il a commandé (Deal + line items)
//   - demo-data/orders.json (notre "faux ERP/entrepôt") : qu'est-ce qui a été réellement
//     expédié. Un vrai CRM ne sait pas ce qui est sorti de l'entrepôt — c'est le métier
//     d'un système de logistique séparé, donc on ne force pas cette donnée dans HubSpot.
//
// Entrée : { order_number?, sender_email }
//   - avec order_number : renvoie cette commande précise
//   - sans order_number : renvoie uniquement les commandes à problème de ce client
// Sortie : { client: { name, email }, orders: [{ order_number, status, discrepancies }] }
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

const DEMO_DATA_DIR = path.join(process.cwd(), "demo-data");
const HUBSPOT_API_BASE = "https://api.hubapi.com";

type FulfillmentRecord = {
  order_number: string;
  status: string;
  shipped_products: { reference: string; quantity: number }[];
};

type Product = { reference: string; quantity: number };
type Discrepancy = { reference: string; ordered: number; shipped: number; missing_quantity: number };
type Deal = { order_number: string; ordered_products: Product[] };

// Petit wrapper pour ne pas répéter l'en-tête d'authentification à chaque appel.
// renvoie null sur une réponse non-OK plutôt que de lever une exception : un
// contact/deal manquant n'est pas une panne, juste une absence de résultat.
async function hubspotFetch(pathSuffix: string, init?: RequestInit) {
  const response = await fetch(`${HUBSPOT_API_BASE}${pathSuffix}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) return null;
  return response.json();
}

// Les line items créés pour cette démo n'ont pas de champ "référence" séparé
// rempli (hs_sku est vide) : la référence (ex. "CAP-100") est à la fin du nom
// du produit ("Capteur de pression CAP-100"), comme dans notre catalogue.
function extractReference(productName: string): string {
  return productName.match(/[A-Z]+-\d+$/)?.[0] ?? productName;
}

async function findContactByEmail(email: string) {
  const result = await hubspotFetch("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
      properties: ["email", "firstname", "lastname"],
    }),
  });
  return result?.results?.[0] ?? null;
}

// Étape 2 du chemin Contact → Deals → Line items : les associations ne
// donnent que des IDs, il faut ensuite aller chercher chaque Deal.
async function findDealIdsForContact(contactId: string): Promise<number[]> {
  const result = await hubspotFetch(`/crm/v4/objects/contacts/${contactId}/associations/deals`);
  return (result?.results ?? []).map((association: { toObjectId: number }) => association.toObjectId);
}

async function getDealWithLineItems(dealId: number): Promise<Deal | null> {
  const deal = await hubspotFetch(`/crm/v3/objects/deals/${dealId}?associations=line_items`);
  if (!deal) return null;

  const lineItemAssociations: { id: string }[] = deal.associations?.["line items"]?.results ?? [];
  const lineItems = await Promise.all(
    lineItemAssociations.map((association) =>
      hubspotFetch(`/crm/v3/objects/line_items/${association.id}?properties=name,quantity`),
    ),
  );

  return {
    order_number: deal.properties.dealname,
    ordered_products: lineItems
      .filter((item) => item !== null)
      .map((item) => ({
        reference: extractReference(item.properties.name),
        quantity: Number(item.properties.quantity),
      })),
  };
}

async function loadFulfillmentRecords(): Promise<FulfillmentRecord[]> {
  const raw = await readFile(path.join(DEMO_DATA_DIR, "orders.json"), "utf-8");
  return JSON.parse(raw);
}

// Compare commandé (HubSpot) vs expédié (notre faux ERP) référence par référence :
// c'est ce calcul qui permet de répondre "il manque 2 unités de CAP-100" au lieu
// de juste renvoyer les deux listes brutes au modèle de génération de réponse.
function computeDiscrepancies(orderedProducts: Product[], shippedProducts: Product[], status: string): Discrepancy[] {
  // Une commande "en cours" ou "en préparation" n'a normalement pas encore tout
  // expédié — ce n'est un vrai écart que si la commande est censée être complète.
  if (status !== "livrée") return [];

  const discrepancies: Discrepancy[] = [];
  for (const orderedItem of orderedProducts) {
    const shippedItem = shippedProducts.find((p) => p.reference === orderedItem.reference);
    const shippedQuantity = shippedItem?.quantity ?? 0;
    if (shippedQuantity < orderedItem.quantity) {
      discrepancies.push({
        reference: orderedItem.reference,
        ordered: orderedItem.quantity,
        shipped: shippedQuantity,
        missing_quantity: orderedItem.quantity - shippedQuantity,
      });
    }
  }
  return discrepancies;
}

export async function POST(request: NextRequest) {
  const { order_number, sender_email } = await request.json();

  if (!sender_email) {
    return NextResponse.json({ error: "sender_email is required" }, { status: 400 });
  }

  const contact = await findContactByEmail(sender_email);
  if (!contact) {
    return NextResponse.json({ error: "client not found" }, { status: 404 });
  }

  const dealIds = await findDealIdsForContact(contact.id);
  const deals = await Promise.all(dealIds.map(getDealWithLineItems));
  const validDeals = deals.filter((deal): deal is Deal => deal !== null);

  const fulfillmentRecords = await loadFulfillmentRecords();

  function buildOrderResult(deal: Deal) {
    // Le statut (livrée / en cours / en préparation) est une info de fulfillment,
    // pas de pipeline commercial — elle vient donc du faux ERP, pas de HubSpot.
    const fulfillment = fulfillmentRecords.find((record) => record.order_number === deal.order_number);
    const status = fulfillment?.status ?? "statut inconnu";
    return {
      order_number: deal.order_number,
      status,
      discrepancies: computeDiscrepancies(deal.ordered_products, fulfillment?.shipped_products ?? [], status),
    };
  }

  // Deux modes : un numéro de commande précis demandé, ou aucun (on remonte
  // alors uniquement les commandes à problème, pour repérer un litige caché).
  const relevantDeals = order_number
    ? validDeals.filter((deal) => deal.order_number === order_number)
    : validDeals.filter((deal) => buildOrderResult(deal).discrepancies.length > 0);

  return NextResponse.json({
    client: {
      name: `${contact.properties.firstname ?? ""} ${contact.properties.lastname ?? ""}`.trim(),
      email: contact.properties.email,
    },
    orders: relevantDeals.map(buildOrderResult),
  });
}
