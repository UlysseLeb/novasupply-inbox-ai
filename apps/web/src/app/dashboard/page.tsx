"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

type Metrics = {
  total_processed: number;
  by_action: { automatic_reply: number; draft_for_approval: number; human_review: number };
  total_cost_usd: number;
  average_cost_usd: number;
  approved_without_modification_rate: number | null;
};

export default function Dashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    fetch("/api/metrics")
      .then((res) => res.json())
      .then(setMetrics);
  }, []);

  if (!metrics) return null;

  if (metrics.total_processed === 0) {
    return (
      <div className={styles.page}>
        <Link href="/" className={styles.backLink}>← Retour à la boîte de réception</Link>
        <h1 className={styles.title}>Tableau de bord ROI</h1>
        <p className={styles.empty}>
          Aucune décision enregistrée encore. Traite quelques emails et clique sur
          Approuver/Modifier/Rejeter/Transférer pour générer des métriques réelles.
        </p>
      </div>
    );
  }

  const { by_action, total_processed } = metrics;
  const pct = (n: number) => Math.round((n / total_processed) * 100);

  return (
    <div className={styles.page}>
      <Link href="/" className={styles.backLink}>← Retour à la boîte de réception</Link>
      <h1 className={styles.title}>Tableau de bord ROI</h1>
      <p className={styles.subtitle}>Métriques calculées à partir des décisions réellement prises dans l&apos;interface.</p>

      <div className={styles.grid}>
        <div className={styles.metricCard}>
          <p className={styles.metricLabel}>Emails traités</p>
          <p className={styles.metricValue}>{total_processed}</p>
        </div>
        <div className={styles.metricCard}>
          <p className={styles.metricLabel}>Coût IA total</p>
          <p className={styles.metricValue}>{metrics.total_cost_usd.toFixed(4)} $</p>
        </div>
        <div className={styles.metricCard}>
          <p className={styles.metricLabel}>Coût moyen par ticket</p>
          <p className={styles.metricValue}>{metrics.average_cost_usd.toFixed(5)} $</p>
        </div>
        <div className={styles.metricCard}>
          <p className={styles.metricLabel}>Brouillons approuvés sans modification</p>
          <p className={styles.metricValue}>
            {metrics.approved_without_modification_rate !== null
              ? `${Math.round(metrics.approved_without_modification_rate * 100)}%`
              : "—"}
          </p>
        </div>
      </div>

      <div className={styles.breakdown}>
        <h2>Répartition par type de traitement</h2>
        <BreakdownRow label="Réponse automatique" value={by_action.automatic_reply} pct={pct(by_action.automatic_reply)} color="var(--level-1)" />
        <BreakdownRow label="Brouillon à valider" value={by_action.draft_for_approval} pct={pct(by_action.draft_for_approval)} color="var(--level-2)" />
        <BreakdownRow label="Transfert humain" value={by_action.human_review} pct={pct(by_action.human_review)} color="var(--level-3)" />
      </div>
    </div>
  );
}

function BreakdownRow({ label, value, pct, color }: { label: string; value: number; pct: number; color: string }) {
  return (
    <div className={styles.breakdownRow}>
      <span className={styles.breakdownLabel}>{label}</span>
      <div className={styles.breakdownBarTrack}>
        <div className={styles.breakdownBarFill} style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={styles.breakdownValue}>{value} ({pct}%)</span>
    </div>
  );
}
