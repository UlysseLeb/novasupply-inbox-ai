// GET /api/metrics  : renvoie les agrégats pour le tableau de bord ROI.
// POST /api/metrics : enregistre une décision réelle (clic Approuver/Modifier/
//   Rejeter/Transférer) prise dans l'interface de validation.
//
// On n'enregistre une métrique QUE quand un humain a réellement pris une
// décision — pas à chaque appel d'API — pour que le tableau de bord reflète
// de l'usage réel, pas du bruit technique.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

// metrics.json vit à la racine du projet : c'est de la donnée générée par
// l'usage de l'app (pas une donnée de démo figée comme demo-data/), donc on
// la garde hors de demo-data/ et hors du suivi git (voir .gitignore).
const METRICS_PATH = path.join(process.cwd(), "..", "..", "metrics.json");

type MetricRecord = {
  complexity_level: 1 | 2 | 3;
  action: "automatic_reply" | "draft_for_approval" | "human_review";
  decision: "approved" | "modified" | "rejected" | "transferred";
  cost_usd: number;
  recorded_at: string;
};

async function loadRecords(): Promise<MetricRecord[]> {
  try {
    const raw = await readFile(METRICS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    // Pas encore de fichier = pas encore de métrique enregistrée, pas une erreur.
    return [];
  }
}

export async function GET() {
  const records = await loadRecords();

  const totalCost = records.reduce((sum, r) => sum + r.cost_usd, 0);
  const byAction = {
    automatic_reply: records.filter((r) => r.action === "automatic_reply").length,
    draft_for_approval: records.filter((r) => r.action === "draft_for_approval").length,
    human_review: records.filter((r) => r.action === "human_review").length,
  };
  const approvedCount = records.filter((r) => r.decision === "approved").length;
  const modifiedCount = records.filter((r) => r.decision === "modified").length;
  // Taux de brouillons acceptés tels quels, sans modification : un bon indicateur
  // de la qualité réelle de /generate-reply (pas juste "ça tourne", mais "c'est bon du premier coup").
  const approvedWithoutModificationRate =
    approvedCount + modifiedCount > 0 ? approvedCount / (approvedCount + modifiedCount) : null;

  return NextResponse.json({
    total_processed: records.length,
    by_action: byAction,
    total_cost_usd: totalCost,
    average_cost_usd: records.length > 0 ? totalCost / records.length : 0,
    approved_without_modification_rate: approvedWithoutModificationRate,
  });
}

export async function POST(request: NextRequest) {
  const { complexity_level, action, decision, cost_usd } = await request.json();

  if (!complexity_level || !action || !decision || cost_usd === undefined) {
    return NextResponse.json(
      { error: "complexity_level, action, decision and cost_usd are required" },
      { status: 400 },
    );
  }

  const records = await loadRecords();
  records.push({ complexity_level, action, decision, cost_usd, recorded_at: new Date().toISOString() });
  await writeFile(METRICS_PATH, JSON.stringify(records, null, 2));

  return NextResponse.json({ ok: true });
}
