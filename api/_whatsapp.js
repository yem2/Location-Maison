import { send, audit, normalizePhone } from "./_lib.js";

// Green API (« WhatsApp par QR code », service géré). Identifiants uniquement dans Vercel :
// GREEN_API_ID, GREEN_API_TOKEN, GREEN_API_URL (ex. https://7107.api.greenapi.com)
export const greenOn = () => !!(process.env.GREEN_API_ID && process.env.GREEN_API_TOKEN);

async function call(path, { method = "GET", body, timeout = 8000 } = {}) {
  const base = String(process.env.GREEN_API_URL || "https://api.green-api.com").replace(/\/+$/, "");
  const id = encodeURIComponent(process.env.GREEN_API_ID), tok = encodeURIComponent(process.env.GREEN_API_TOKEN);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(`${base}/waInstance${id}/${path}/${tok}`, {
      method, signal: ctrl.signal,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
  } finally { clearTimeout(timer); }
}

// Utilisable par le reste du site pour envoyer une notification : await sendGreen("237699123456", "texte")
export async function sendGreen(to, text) {
  if (!greenOn()) return false;
  try {
    const r = await call("sendMessage", { method: "POST", timeout: 6000, body: { chatId: `${to}@c.us`, message: String(text).replace(/\s+/g, " ").slice(0, 900) } });
    return r.ok && !!r.json?.idMessage;
  } catch { return false; }
}

const STATE = { authorized: "connected", yellowCard: "connected", notAuthorized: "qr", starting: "starting", sleepMode: "starting", blocked: "failed" };

// Appelé depuis api/console.js (déjà authentifié) pour les actions wa_status, wa_qr, wa_start, wa_test, wa_logout
export async function waHandler(req, res, me) {
  if (me.role !== "super_admin") return send(res, 403, { error: "Réservé au super administrateur" });
  const a = String(req.query.a || "").replace(/^wa_/, "");
  if (!greenOn()) return send(res, 200, { configured: false, meta: !!process.env.WA_ACCESS_TOKEN });
  try {
    if (a === "status") {
      const r = await call("getStateInstance");
      if (!r.ok) return send(res, 200, { configured: true, state: "unreachable" });
      const state = STATE[r.json?.stateInstance] || "stopped";
      let number = "";
      if (state === "connected") {
        const w = await call("getWaSettings").catch(() => null);
        const d = String(w?.json?.phone || "").replace(/\D/g, "");
        if (d) number = `+${d.slice(0, 3)} ••• ${d.slice(-3)}`;
      }
      return send(res, 200, { configured: true, state, number, warning: r.json?.stateInstance === "yellowCard" });
    }
    if (a === "qr") {
      const r = await call("qr");
      if (!r.ok || r.json?.type !== "qrCode" || !r.json?.message) return send(res, 200, { image: null });
      return send(res, 200, { image: `data:image/png;base64,${r.json.message}` });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Méthode refusée" });
    if (a === "start") {
      const r = await call("reboot");
      await audit(me.id, "whatsapp.reboot", "");
      return send(res, 200, { ok: r.ok });
    }
    if (a === "test") {
      const to = normalizePhone(req.body?.phone);
      if (!to) return send(res, 400, { error: "Numéro invalide (avec l'indicatif, ex. +237 699 12 34 56)" });
      const ok = await sendGreen(to, "Gestion immobilière : message de test envoyé depuis le tableau de bord.");
      await audit(me.id, "whatsapp.test", "…" + to.slice(-3));
      return send(res, ok ? 200 : 502, ok ? { ok: true } : { error: "Envoi impossible : numéro connecté ? limite du forfait atteinte ?" });
    }
    if (a === "logout") {
      const r = await call("logout");
      await audit(me.id, "whatsapp.logout", "");
      return send(res, 200, { ok: r.ok && r.json?.isLogout !== false });
    }
  } catch { return send(res, 502, { error: "Green API injoignable" }); }
  send(res, 404, { error: "Inconnu" });
}
