// Fonction Supabase « gestion-eleves » : création, réinitialisation et suppression des comptes élèves,
// appelée par l'espace prof du portail. Seule à détenir la clé de service ; elle vérifie elle-même que
// l'appelant est un prof connecté et que la classe visée est la sienne.
// Déploiement : Edge Functions > Deploy a new function > Via Editor, nom « gestion-eleves », coller ce fichier en
// entier (docs/INSTALLATION.md). Aucun import : un seul fichier, sans dépendance.
// Corps de la requête (POST, JSON) : { "action": …, … } ; réponses en JSON, erreurs { "erreur": "…" } en français.
//   creer_eleves     { classe_id, eleves: [{ prenom, nom }] }  → { eleves: [{ id, prenom, nom, identifiant, mot_de_passe }], erreurs: [{ ligne, prenom, nom, erreur }] }
//   reinitialiser    { eleve_id }                               → { identifiant, mot_de_passe }
//   supprimer_eleve  { eleve_id }                               → { ok: true }
//   supprimer_classe { classe_id }                              → { ok: true, eleves_supprimes }
// L'identifiant et le mot de passe sont fabriqués comme dans module/suivi.js (tests/fonction.test.js le vérifie).

export const DOMAINE_ELEVES = "eleves.invalid";
export const MAX_ELEVES = 40;
export const ORIGINES = ["https://s-kajzar.github.io"];

type Env = { url: string; cle: string; origines?: string[] };
type Reponse = { ok: boolean; status: number; donnees: any };
type Prof = { id: string };

// ============================================================ identifiants et mots de passe

export function normaliser(texte: string): string {
  return String(texte || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/æ/g, "ae").replace(/œ/g, "oe").replace(/ß/g, "ss").replace(/ø/g, "o").replace(/đ/g, "d")
    .replace(/ł/g, "l").replace(/ı/g, "i")
    .replace(/['’‘`´]/g, "").replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// « prenom.nom », 30 caractères au plus ; un chiffre à partir de 2 si l'identifiant est déjà pris
export function identifiantDe(prenom: string, nom: string, pris: Set<string>): string {
  const base = ((normaliser(prenom) || "eleve") + "." + (normaliser(nom) || "eleve")).slice(0, 30).replace(/[.-]+$/, "");
  if (!pris.has(base)) return base;
  for (let i = 2; ; i++) {
    const s = String(i);
    const essai = base.slice(0, 30 - s.length).replace(/[.-]+$/, "") + s;
    if (!pris.has(essai)) return essai;
  }
}

// trois syllabes et deux chiffres, sans caractères ambigus (ni 0, o, 1, l, i) : « bavume47 »
const CONSONNES = "bcdfghjkmnprstvz", VOYELLES = "aeuy", CHIFFRES = "23456789";
export function motDePasse(octets: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const o = octets(8);
  let m = "";
  for (let i = 0; i < 3; i++) m += CONSONNES[o[2 * i] & 15] + VOYELLES[o[2 * i + 1] & 3];
  return m + CHIFFRES[o[6] & 7] + CHIFFRES[o[7] & 7];
}

// ============================================================ réponses HTTP

function entetesCors(origine: string | null, env: Env): Record<string, string> {
  const permises = env.origines || ORIGINES;
  const locale = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origine || "");
  return {
    "Access-Control-Allow-Origin": origine && (permises.includes(origine) || locale) ? origine : permises[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

class Refus extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(v: unknown, quoi: string): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new Refus(400, quoi + " manquant ou invalide.");
  return v.toLowerCase();
}

// ============================================================ traitement d'une requête

export async function traiter(req: Request, env: Env, f: typeof fetch = fetch): Promise<Response> {
  const cors = entetesCors(req.headers.get("Origin"), env);
  const json = (status: number, corps: unknown) =>
    new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { erreur: "Méthode non permise : POST seulement." });
  if (!env.url || !env.cle) {
    return json(500, { erreur: "Configuration de la fonction incomplète : clé de service absente (voir docs/INSTALLATION.md)." });
  }

  // clé de service : une ancienne clé (jeton « eyJ… ») va aussi dans Authorization ; une clé « sb_secret_… » non
  const service: Record<string, string> = { apikey: env.cle, "Content-Type": "application/json" };
  if (env.cle.startsWith("eyJ")) service.Authorization = "Bearer " + env.cle;

  async function appel(methode: string, chemin: string, corps?: unknown, entetes?: Record<string, string>): Promise<Reponse> {
    let r: Response;
    try {
      r = await f(env.url.replace(/\/+$/, "") + chemin, {
        method: methode, headers: { ...service, ...(entetes || {}) },
        body: corps === undefined ? undefined : JSON.stringify(corps),
      });
    } catch (_e) {
      throw new Refus(502, "Service Supabase injoignable depuis la fonction.");
    }
    const texte = await r.text();
    let donnees: any = null;
    try { donnees = texte ? JSON.parse(texte) : null; } catch (_e) { donnees = texte; }
    return { ok: r.ok, status: r.status, donnees };
  }
  const rest = (methode: string, chemin: string, corps?: unknown, prefer?: string) =>
    appel(methode, "/rest/v1/" + chemin, corps, prefer ? { Prefer: prefer } : undefined);
  const admin = (methode: string, chemin: string, corps?: unknown) => appel(methode, "/auth/v1/admin/" + chemin, corps);
  function verifier(r: Reponse, quoi: string): any {
    if (!r.ok) throw new Refus(502, quoi + " : refus du service (statut " + r.status + ").");
    return r.donnees;
  }

  try {
    // 1. l'appelant : un prof connecté
    const jeton = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!jeton) throw new Refus(401, "Connexion requise.");
    const moi = await appel("GET", "/auth/v1/user", undefined, { Authorization: "Bearer " + jeton });
    if (!moi.ok || !moi.donnees || !moi.donnees.id) throw new Refus(401, "Session expirée ou invalide : reconnecte-toi.");
    const profil = verifier(await rest("GET", "profils?select=id,role&id=eq." + uuid(moi.donnees.id, "Compte")), "Lecture du profil");
    if (!profil.length || profil[0].role !== "prof") throw new Refus(403, "Action réservée aux professeurs.");
    const prof: Prof = { id: profil[0].id };

    let corps: any;
    try { corps = await req.json(); } catch (_e) { throw new Refus(400, "Requête illisible : JSON attendu."); }
    if (!corps || typeof corps !== "object") throw new Refus(400, "Requête illisible : JSON attendu.");

    async function classeDuProf(classeId: unknown) {
      const id = uuid(classeId, "Classe");
      const c = verifier(await rest("GET", "classes?select=id,nom&id=eq." + id + "&prof_id=eq." + prof.id), "Lecture de la classe");
      if (!c.length) throw new Refus(403, "Classe introuvable, ou classe d'un autre professeur.");
      return c[0];
    }
    async function eleveDuProf(eleveId: unknown) {
      const id = uuid(eleveId, "Élève");
      const e = verifier(await rest("GET", "profils?select=id,role,identifiant,classe_id&id=eq." + id), "Lecture de l'élève");
      if (!e.length || e[0].role !== "eleve") throw new Refus(404, "Élève introuvable.");
      await classeDuProf(e[0].classe_id);
      return e[0];
    }

    switch (corps.action) {
      case "creer_eleves": {
        const classe = await classeDuProf(corps.classe_id);
        const liste = corps.eleves;
        if (!Array.isArray(liste) || !liste.length) throw new Refus(400, "Liste d'élèves vide.");
        if (liste.length > MAX_ELEVES) throw new Refus(400, "Au plus " + MAX_ELEVES + " élèves par envoi.");
        const lignes = liste.map((e: any, i: number) => {
          const prenom = typeof e?.prenom === "string" ? e.prenom.trim() : "";
          const nom = typeof e?.nom === "string" ? e.nom.trim() : "";
          if (!prenom || !nom || prenom.length > 60 || nom.length > 60) {
            throw new Refus(400, "Ligne " + (i + 1) + " : prénom ou nom manquant (60 caractères au plus).");
          }
          return { prenom, nom };
        });
        const pris = new Set<string>(verifier(await rest("GET", "profils?select=identifiant"), "Lecture des identifiants")
          .map((p: any) => p.identifiant));
        const eleves: any[] = [], erreurs: any[] = [];
        for (let i = 0; i < lignes.length; i++) {
          const { prenom, nom } = lignes[i];
          let cree: any = null, erreur = "";
          for (let essai = 0; essai < 4 && !cree; essai++) {
            const identifiant = identifiantDe(prenom, nom, pris);
            pris.add(identifiant);
            const mot_de_passe = motDePasse();
            const u = await admin("POST", "users", {
              email: identifiant + "@" + DOMAINE_ELEVES, password: mot_de_passe, email_confirm: true,
              user_metadata: { prenom, nom },
            });
            const code = u.donnees?.error_code || u.donnees?.code;
            if (!u.ok && (code === "email_exists" || code === "user_already_exists")) {
              erreur = "identifiant déjà pris";  // compte existant sans profil : identifiant suivant
              continue;
            }
            if (!u.ok || !u.donnees?.id) {
              const msg = u.donnees?.msg || u.donnees?.message || u.donnees?.error_description || "";
              erreur = "création du compte refusée (statut " + u.status + (msg ? " : " + msg : "") + ")";
              break;
            }
            const p = await rest("POST", "profils", { id: u.donnees.id, role: "eleve", prenom, nom, identifiant, classe_id: classe.id },
              "return=minimal");
            if (p.ok) { cree = { id: u.donnees.id, prenom, nom, identifiant, mot_de_passe }; break; }
            await admin("DELETE", "users/" + u.donnees.id);  // pas de compte sans profil
            erreur = p.status === 409 ? "identifiant déjà pris" : "création du profil refusée (statut " + p.status + ")";
            if (p.status !== 409) break;
          }
          if (cree) eleves.push(cree); else erreurs.push({ ligne: i + 1, prenom, nom, erreur });
        }
        return json(erreurs.length && !eleves.length ? 502 : 200, { eleves, erreurs });
      }
      case "reinitialiser": {
        const eleve = await eleveDuProf(corps.eleve_id);
        const mot_de_passe = motDePasse();
        verifier(await admin("PUT", "users/" + eleve.id, { password: mot_de_passe }), "Changement du mot de passe");
        return json(200, { identifiant: eleve.identifiant, mot_de_passe });
      }
      case "supprimer_eleve": {
        const eleve = await eleveDuProf(corps.eleve_id);
        verifier(await admin("DELETE", "users/" + eleve.id), "Suppression du compte");
        return json(200, { ok: true });
      }
      case "supprimer_classe": {
        const classe = await classeDuProf(corps.classe_id);
        const eleves = verifier(await rest("GET", "profils?select=id&classe_id=eq." + classe.id), "Lecture des élèves");
        for (const e of eleves) verifier(await admin("DELETE", "users/" + e.id), "Suppression d'un compte élève");
        verifier(await rest("DELETE", "classes?id=eq." + classe.id, undefined, "return=minimal"), "Suppression de la classe");
        return json(200, { ok: true, eleves_supprimes: eleves.length });
      }
      default:
        throw new Refus(400, "Action inconnue : creer_eleves, reinitialiser, supprimer_eleve ou supprimer_classe.");
    }
  } catch (e) {
    if (e instanceof Refus) return json(e.status, { erreur: e.message });
    return json(500, { erreur: "Erreur interne de la fonction." });
  }
}

// ============================================================ lancement dans Supabase (Deno)

const D = (globalThis as any).Deno;
if (D && typeof D.serve === "function") {
  const lire = (k: string) => D.env.get(k) || "";
  D.serve((req: Request) => traiter(req, {
    url: lire("SUPABASE_URL"),
    cle: lire("CLE_SECRETE") || lire("SUPABASE_SERVICE_ROLE_KEY"),
    origines: lire("ORIGINES_AUTORISEES") ? lire("ORIGINES_AUTORISEES").split(",").map((o: string) => o.trim()) : ORIGINES,
  }));
}
