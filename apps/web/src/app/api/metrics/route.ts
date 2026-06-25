// GET /api/metrics  : renvoie les agrégats pour le tableau de bord ROI.
// POST /api/metrics : enregistre une décision réelle (clic Approuver/Modifier/
//   Rejeter/Transférer) prise dans l'interface de validation.
//
// On n'enregistre une métrique QUE quand un humain a réellement pris une
// décision — pas à chaque appel d'API — pour que le tableau de bord reflète
// de l'usage réel, pas du bruit technique.
import { NextRequest, NextResponse } from "next/server";
import { appendRecord, loadRecords } from "@/lib/metrics-store";

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

  await appendRecord({ complexity_level, action, decision, cost_usd, recorded_at: new Date().toISOString() });

  return NextResponse.json({ ok: true });
}
