// Script d'évaluation : envoie chaque cas de tickets.json à l'API de classification
// et compare le résultat à la réponse attendue, pour mesurer la fiabilité du système.
//
// Prérequis : le serveur Next.js doit tourner (cd apps/web && npm run dev).
import { readFile } from "node:fs/promises";

const API_URL = "http://localhost:3000/api/classify-ticket";

// Le modèle ne renvoie que complexity_level et automatic_reply_allowed ;
// on en déduit ici l'action métier, pour pouvoir la comparer à expected_action.
// (Cette logique sera reprise plus tard dans une vraie couche de règles métier,
// séparée de l'appel au modèle — pour l'instant on la garde simple côté éval.)
function deriveAction(complexity_level, automatic_reply_allowed) {
  if (complexity_level === 1 && automatic_reply_allowed) return "automatic_reply";
  if (complexity_level === 3) return "human_review";
  return "draft_for_approval";
}

async function classify(email_text) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email_text }),
  });
  if (!response.ok) {
    throw new Error(`API a répondu ${response.status}`);
  }
  return response.json();
}

async function main() {
  const raw = await readFile(new URL("./tickets.json", import.meta.url), "utf-8");
  const tickets = JSON.parse(raw);

  let correctLevel = 0;
  let correctAction = 0;
  const results = [];

  // On traite les cas un par un (pas en parallèle) pour rester simple
  // et éviter de cogner les limites de débit de l'API sur un petit volume comme celui-ci.
  for (const ticket of tickets) {
    const classification = await classify(ticket.email);
    const predictedAction = deriveAction(
      classification.complexity_level,
      classification.automatic_reply_allowed,
    );

    const levelOk = classification.complexity_level === ticket.expected_level;
    const actionOk = predictedAction === ticket.expected_action;
    if (levelOk) correctLevel += 1;
    if (actionOk) correctAction += 1;

    results.push({
      email: ticket.email.slice(0, 50),
      expected_level: ticket.expected_level,
      predicted_level: classification.complexity_level,
      levelOk,
      expected_action: ticket.expected_action,
      predicted_action: predictedAction,
      actionOk,
    });
  }

  console.table(results);
  console.log(
    `\nNiveau correct : ${correctLevel}/${tickets.length} (${((correctLevel / tickets.length) * 100).toFixed(0)}%)`,
  );
  console.log(
    `Action correcte : ${correctAction}/${tickets.length} (${((correctAction / tickets.length) * 100).toFixed(0)}%)`,
  );
}

main().catch((error) => {
  console.error("Erreur pendant l'évaluation :", error.message);
  process.exit(1);
});
