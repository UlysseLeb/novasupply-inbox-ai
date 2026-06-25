// POST /api/retrieve-context
// Rôle : vérifier dans les vraies données de NovaSupply ce qu'il en est réellement
// (pas de confiance aveugle en ce que dit l'email ou le PDF). Permet de répondre
// avec des faits vérifiés plutôt que de répéter ce que le client a affirmé.
// Entrée : { order_number?, sender_email }
//   - avec order_number : renvoie cette commande précise
//   - sans order_number : renvoie uniquement les commandes à problème de ce client
// Sortie : { client: { name, email }, orders: [{ order_number, status, discrepancies }] }
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

// demo-data/ vit dans apps/web/ pour que Vercel l'inclue dans le déploiement
// (le build ne packe que le répertoire racine du projet). Pas d'appel IA ici :
// c'est une vraie recherche dans nos "fausses" données NovaSupply, pas une
// déduction du modèle.
const DEMO_DATA_DIR = path.join(process.cwd(), "demo-data");

type Client = { client_id: string; name: string; email: string; city: string };
type Order = {
  order_number: string;
  client_id: string;
  status: string;
  ordered_products: { reference: string; quantity: number }[];
  shipped_products: { reference: string; quantity: number }[];
};

async function loadJson<T>(filename: string): Promise<T> {
  const raw = await readFile(path.join(DEMO_DATA_DIR, filename), "utf-8");
  return JSON.parse(raw) as T;
}

// Compare commandé vs livré référence par référence : c'est ce calcul qui
// permet de répondre "il manque 2 unités de CAP-100" au lieu de juste
// renvoyer les deux listes brutes au modèle de génération de réponse.
function computeDiscrepancies(order: Order) {
  const discrepancies: { reference: string; ordered: number; shipped: number; missing_quantity: number }[] = [];

  // Une commande "en cours" ou "en préparation" n'a normalement pas encore tout expédié —
  // ce n'est un vrai écart que si la commande est censée être livrée en totalité.
  if (order.status !== "livrée") {
    return discrepancies;
  }

  for (const orderedItem of order.ordered_products) {
    const shippedItem = order.shipped_products.find((p) => p.reference === orderedItem.reference);
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

  const [clients, orders] = await Promise.all([
    loadJson<Client[]>("clients.json"),
    loadJson<Order[]>("orders.json"),
  ]);

  const client = clients.find((c) => c.email === sender_email);
  if (!client) {
    return NextResponse.json({ error: "client not found" }, { status: 404 });
  }

  const clientOrders = orders.filter((o) => o.client_id === client.client_id);

  // Deux modes : un numéro de commande précis demandé, ou aucun (on remonte
  // alors uniquement les commandes à problème, pour repérer un litige caché).
  const relevantOrders = order_number
    ? clientOrders.filter((o) => o.order_number === order_number)
    : clientOrders.filter((o) => computeDiscrepancies(o).length > 0);

  return NextResponse.json({
    client: { name: client.name, email: client.email },
    orders: relevantOrders.map((order) => ({
      order_number: order.order_number,
      status: order.status,
      discrepancies: computeDiscrepancies(order),
    })),
  });
}
