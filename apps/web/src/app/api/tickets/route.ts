// GET /api/tickets
// Rôle : fournir la liste d'emails pour la "boîte de réception" de l'interface
// de validation. On réutilise nos cas de test (evaluations/tickets.json) comme
// jeu de démo réaliste : il couvre déjà les 3 niveaux de complexité.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const TICKETS_PATH = path.join(process.cwd(), "..", "..", "evaluations", "tickets.json");

export async function GET() {
  const raw = await readFile(TICKETS_PATH, "utf-8");
  const tickets = JSON.parse(raw);

  // On ne renvoie pas expected_* (c'est le corrigé interne des tests, pas une
  // donnée que l'interface de validation doit connaître ou afficher).
  const inbox = tickets.map((ticket: Record<string, unknown>, index: number) => ({
    id: index,
    email_subject: ticket.email_subject,
    email_text: ticket.email,
    sender_email: ticket.sender_email,
  }));

  return NextResponse.json(inbox);
}
