"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

type Ticket = {
  id: number;
  email_subject: string;
  email_text: string;
  sender_email: string;
};

type Classification = {
  category: string;
  priority: string;
  complexity_level: 1 | 2 | 3;
  sentiment: string;
  automatic_reply_allowed: boolean;
  confidence: number;
  cost_usd: number;
};

type RetrieveContext = {
  client: { name: string; email: string };
  orders: { order_number: string; status: string; discrepancies: unknown[] }[];
};

type GeneratedReply = {
  reply_text: string;
  suggested_actions: string[];
  cost_usd: number;
};

// Même règle que evaluations/run.mjs : on déduit l'action métier à partir
// du niveau de complexité, pour alimenter le tableau de bord ROI avec
// la même logique que celle utilisée pour évaluer la qualité du système.
function deriveAction(complexityLevel: 1 | 2 | 3, automaticReplyAllowed: boolean) {
  if (complexityLevel === 1 && automaticReplyAllowed) return "automatic_reply" as const;
  if (complexityLevel === 3) return "human_review" as const;
  return "draft_for_approval" as const;
}

// Étapes possibles du pipeline, affichées comme indicateurs de progression
// pour que l'utilisateur voie QUELLES sources ont été utilisées — pas juste le résultat final.
type StepStatus = "pending" | "running" | "done" | "skipped" | "error";

// Le texte de l'email contient parfois directement un numéro de commande
// (ex. "CMD-2045") : on le repère pour cibler /retrieve-context sans avoir
// besoin d'un vrai PDF joint (qu'on ne gère pas dans cette interface de démo).
function extractOrderNumber(text: string): string | undefined {
  return text.match(/CMD-\d+/)?.[0];
}

export default function Home() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [steps, setSteps] = useState<Record<string, StepStatus>>({
    classify: "pending",
    retrieve: "pending",
    generate: "pending",
  });
  const [classification, setClassification] = useState<Classification | null>(null);
  const [context, setContext] = useState<RetrieveContext | null>(null);
  const [reply, setReply] = useState<GeneratedReply | null>(null);
  const [decision, setDecision] = useState<string | null>(null);
  // Coût réel cumulé pour le ticket en cours (classification + génération du
  // brouillon) — c'est ce chiffre qu'on enverra à /api/metrics au moment de la décision.
  const [totalCostUsd, setTotalCostUsd] = useState(0);

  useEffect(() => {
    fetch("/api/tickets")
      .then((res) => res.json())
      .then(setTickets);
  }, []);

  async function handleSelect(ticket: Ticket) {
    setSelectedId(ticket.id);
    setDecision(null);
    setClassification(null);
    setContext(null);
    setReply(null);
    setTotalCostUsd(0);
    setSteps({ classify: "running", retrieve: "pending", generate: "pending" });

    // Étape 1 : toujours appelée, c'est elle qui décide du niveau de traitement.
    const classifyRes = await fetch("/api/classify-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email_subject: ticket.email_subject,
        email_text: ticket.email_text,
        sender_email: ticket.sender_email,
      }),
    });
    const classificationResult: Classification = await classifyRes.json();
    setClassification(classificationResult);
    setTotalCostUsd((c) => c + classificationResult.cost_usd);
    setSteps((s) => ({ ...s, classify: "done" }));

    // Étape 2 : uniquement pour les niveaux 2 et 3 (il y a une affirmation à
    // vérifier) — un niveau 1 (FAQ générique) n'a rien à aller chercher.
    let contextResult: RetrieveContext | null = null;
    if (classificationResult.complexity_level >= 2) {
      setSteps((s) => ({ ...s, retrieve: "running" }));
      const retrieveRes = await fetch("/api/retrieve-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_number: extractOrderNumber(ticket.email_text),
          sender_email: ticket.sender_email,
        }),
      });
      if (retrieveRes.ok) {
        contextResult = await retrieveRes.json();
        setContext(contextResult);
      }
      setSteps((s) => ({ ...s, retrieve: "done" }));
    } else {
      setSteps((s) => ({ ...s, retrieve: "skipped" }));
    }

    // Étape 3 : toujours appelée, avec tout ce qu'on a récolté jusqu'ici.
    setSteps((s) => ({ ...s, generate: "running" }));
    const replyRes = await fetch("/api/generate-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email_subject: ticket.email_subject,
        email_text: ticket.email_text,
        classification: classificationResult,
        context: contextResult,
      }),
    });
    const replyResult: GeneratedReply = await replyRes.json();
    setReply(replyResult);
    setTotalCostUsd((c) => c + replyResult.cost_usd);
    setSteps((s) => ({ ...s, generate: "done" }));
  }

  // Enregistre la décision réelle (clic humain) dans /api/metrics, pour le
  // tableau de bord ROI — c'est le seul moment où on écrit une métrique.
  // On ATTEND la fin de la requête avant d'afficher la confirmation : sinon,
  // si l'utilisateur navigue ailleurs juste après son clic, le navigateur
  // annule la requête en vol et la métrique est silencieusement perdue.
  async function recordDecision(
    label: string,
    decisionKey: "approved" | "modified" | "rejected" | "transferred",
  ) {
    if (!classification) return;
    await fetch("/api/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        complexity_level: classification.complexity_level,
        action: deriveAction(classification.complexity_level, classification.automatic_reply_allowed),
        decision: decisionKey,
        cost_usd: totalCostUsd,
      }),
    });
    setDecision(label);
  }

  const selectedTicket = tickets.find((t) => t.id === selectedId) ?? null;

  return (
    <div className={styles.layout}>
      <aside className={styles.inbox}>
        <h1 className={styles.inboxTitle}>NovaSupply — Boîte de réception</h1>
        <Link href="/dashboard" className={styles.dashboardLink}>Voir le tableau de bord ROI →</Link>
        <ul className={styles.ticketList}>
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <button
                className={`${styles.ticketItem} ${ticket.id === selectedId ? styles.ticketItemActive : ""}`}
                onClick={() => handleSelect(ticket)}
              >
                <span className={styles.ticketSubject}>{ticket.email_subject}</span>
                <span className={styles.ticketSender}>{ticket.sender_email}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className={styles.detail}>
        {!selectedTicket && <p className={styles.placeholder}>Sélectionne un email à gauche pour démarrer l&apos;analyse.</p>}

        {selectedTicket && (
          <>
            <section className={styles.originalEmail}>
              <h2>{selectedTicket.email_subject}</h2>
              <p className={styles.meta}>De : {selectedTicket.sender_email}</p>
              <p>{selectedTicket.email_text}</p>
            </section>

            <section className={styles.pipeline}>
              <PipelineStep label="1. Classification" status={steps.classify} />
              <PipelineStep label="2. Vérification des données (retrieve-context)" status={steps.retrieve} />
              <PipelineStep label="3. Génération du brouillon" status={steps.generate} />
            </section>

            {classification && (
              <section className={styles.card}>
                <h3>Classification</h3>
                <p>
                  Catégorie : <strong>{classification.category}</strong> · Priorité : {classification.priority} ·
                  Niveau : {classification.complexity_level} · Sentiment : {classification.sentiment}
                </p>
                <p>Confiance : {Math.round(classification.confidence * 100)}%</p>
              </section>
            )}

            {context && (
              <section className={styles.card}>
                <h3>Contexte vérifié</h3>
                <p>Client : {context.client.name} ({context.client.email})</p>
                {context.orders.length === 0 && <p>Aucune commande à problème trouvée.</p>}
                {context.orders.map((order) => (
                  <p key={order.order_number}>
                    {order.order_number} — {order.status}
                    {order.discrepancies.length > 0 ? ` — ${order.discrepancies.length} écart(s)` : " — conforme"}
                  </p>
                ))}
              </section>
            )}

            {reply && (
              <section className={styles.card}>
                <h3>Brouillon de réponse</h3>
                <p className={styles.replyText}>{reply.reply_text}</p>
                <h4>Actions à déclencher après validation</h4>
                <ul>
                  {reply.suggested_actions.map((action, i) => (
                    <li key={i}>{action}</li>
                  ))}
                </ul>

                {decision ? (
                  <p className={styles.decision}>Décision enregistrée : {decision}</p>
                ) : (
                  <div className={styles.actions}>
                    <button onClick={() => recordDecision("Approuvé et envoyé", "approved")}>Approuver</button>
                    <button onClick={() => recordDecision("Marqué à modifier", "modified")}>Modifier</button>
                    <button onClick={() => recordDecision("Rejeté", "rejected")}>Rejeter</button>
                    <button onClick={() => recordDecision("Transféré à un humain", "transferred")}>Transférer</button>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function PipelineStep({ label, status }: { label: string; status: StepStatus }) {
  const icon = { pending: "○", running: "…", done: "✓", skipped: "—", error: "✗" }[status];
  return (
    <p className={styles.pipelineStep} data-status={status}>
      {icon} {label}
    </p>
  );
}
