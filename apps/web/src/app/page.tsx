"use client";

import { useEffect, useState } from "react";
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
};

type RetrieveContext = {
  client: { name: string; email: string };
  orders: { order_number: string; status: string; discrepancies: unknown[] }[];
};

type GeneratedReply = {
  reply_text: string;
  suggested_actions: string[];
};

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
    setReply(await replyRes.json());
    setSteps((s) => ({ ...s, generate: "done" }));
  }

  const selectedTicket = tickets.find((t) => t.id === selectedId) ?? null;

  return (
    <div className={styles.layout}>
      <aside className={styles.inbox}>
        <h1 className={styles.inboxTitle}>NovaSupply — Boîte de réception</h1>
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
                    <button onClick={() => setDecision("Approuvé et envoyé")}>Approuver</button>
                    <button onClick={() => setDecision("Marqué à modifier")}>Modifier</button>
                    <button onClick={() => setDecision("Rejeté")}>Rejeter</button>
                    <button onClick={() => setDecision("Transféré à un humain")}>Transférer</button>
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
