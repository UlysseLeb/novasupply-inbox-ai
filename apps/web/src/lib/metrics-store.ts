// Stockage des métriques ROI : abstrait pour fonctionner aussi bien en local
// (fichier sur disque, simple et zéro dépendance) qu'en déploiement serverless
// (Vercel) où le système de fichiers est éphémère entre deux invocations —
// sans backend externe, le dashboard se viderait à chaque cold start.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Redis } from "@upstash/redis";

export type MetricRecord = {
  complexity_level: 1 | 2 | 3;
  action: "automatic_reply" | "draft_for_approval" | "human_review";
  decision: "approved" | "modified" | "rejected" | "transferred";
  cost_usd: number;
  recorded_at: string;
};

const METRICS_KEY = "metrics_records";
// metrics.json vit à la racine du projet (hors demo-data/ et hors git, voir
// .gitignore) puisque c'est de la donnée générée par l'usage, pas une donnée
// de démo figée.
const METRICS_PATH = path.join(process.cwd(), "..", "..", "metrics.json");

// On ne crée le client Redis que si les credentials Upstash sont présentes :
// ça permet de continuer à développer en local avec le simple fichier JSON,
// sans avoir à provisionner Upstash juste pour lancer `npm run dev`.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

async function loadFromFile(): Promise<MetricRecord[]> {
  try {
    const raw = await readFile(METRICS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    // Pas encore de fichier = pas encore de métrique enregistrée, pas une erreur.
    return [];
  }
}

export async function loadRecords(): Promise<MetricRecord[]> {
  if (redis) {
    try {
      return await redis.lrange<MetricRecord>(METRICS_KEY, 0, -1);
    } catch {
      // Upstash injoignable (ex. base supprimée pour inactivité sur le plan
      // gratuit) : on retombe sur le fichier local plutôt que de faire
      // planter le tableau de bord — un dashboard vide vaut mieux qu'un 500.
      return loadFromFile();
    }
  }
  return loadFromFile();
}

export async function appendRecord(record: MetricRecord): Promise<void> {
  if (redis) {
    try {
      await redis.rpush(METRICS_KEY, record);
      return;
    } catch {
      // Même repli qu'au-dessus : on ne bloque pas la décision humaine
      // (Approve/Modify/Reject/Transfer) si Upstash est indisponible.
    }
  }
  const records = await loadFromFile();
  records.push(record);
  await writeFile(METRICS_PATH, JSON.stringify(records, null, 2));
}
