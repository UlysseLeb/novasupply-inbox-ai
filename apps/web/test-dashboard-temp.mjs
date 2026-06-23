import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
page.on("pageerror", (err) => errors.push(String(err)));

async function processAndDecide(subjectText, buttonLabel) {
  await page.goto("http://localhost:3000");
  await page.waitForSelector("text=NovaSupply — Boîte de réception");
  await page.click(`text=${subjectText}`);
  await page.waitForSelector("text=Approuver", { timeout: 30000 });
  await page.click(`button:has-text("${buttonLabel}")`);
  await page.waitForSelector("text=Décision enregistrée");
}

// Niveau 1 -> Approuver, Niveau 2 -> Approuver, Niveau 3 -> Transférer
await processAndDecide("Copie de facture", "Approuver");
await processAndDecide("Commande CMD-2045 incomplète", "Approuver");
await processAndDecide("Mise en demeure", "Transférer");

await page.goto("http://localhost:3000/dashboard");
await page.waitForSelector("text=Tableau de bord ROI");
await page.screenshot({ path: "/tmp/dashboard.png", fullPage: true });

console.log("ERREURS CONSOLE:", JSON.stringify(errors));
console.log("OK");
await browser.close();
