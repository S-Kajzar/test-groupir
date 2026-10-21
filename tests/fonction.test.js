// Fonction gestion-eleves (supabase/functions/gestion-eleves/index.ts) contre un faux Supabase :
// identifiants, mots de passe, contrôle de l'appelant, quatre actions, en-têtes CORS et clé de service.
// Usage : node --test tests/fonction.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { chargerFonction } = require("./outils");

const ORIGINE = "https://s-kajzar.github.io";
const MDP = /^([bcdfghjkmnprstvz][aeuy]){3}[2-9]{2}$/;
let F;
test.before(async () => { F = await chargerFonction(); });

// ---------- faux Supabase : authentification, administration des comptes, API REST (profils, classes)
function fauxSupabase(cle) {
  const etat = { users: new Map(), profils: [], classes: [], jetons: new Map(), appels: [] };
  let n = 0;
  const uid = () => "00000000-0000-4000-8000-" + String(++n).padStart(12, "0");
  const rep = (status, d) => new Response(d === undefined ? null : JSON.stringify(d), { status });
  function filtrer(lignes, params) {
    return lignes.filter((l) => [...params].every(([k, v]) => k === "select" || (v.startsWith("eq.") && String(l[k]) === v.slice(3))));
  }
  async function f(adresse, init) {
    init = init || {};
    const u = new URL(adresse), m = (init.method || "GET").toUpperCase(), h = init.headers || {};
    const corps = init.body ? JSON.parse(init.body) : undefined;
    etat.appels.push({ m, chemin: u.pathname + u.search, h });
    if (u.pathname === "/auth/v1/user") {
      const id = etat.jetons.get((h.Authorization || "").replace("Bearer ", ""));
      return id ? rep(200, { id }) : rep(401, { msg: "invalid JWT" });
    }
    if (h.apikey !== cle) return rep(401, { message: "Invalid API key" });
    if (u.pathname === "/auth/v1/admin/users" && m === "POST") {
      if ([...etat.users.values()].some((x) => x.email === corps.email)) return rep(422, { error_code: "email_exists", msg: "exists" });
      const id = uid();
      etat.users.set(id, { id, email: corps.email, password: corps.password, email_confirm: corps.email_confirm });
      return rep(200, { id, email: corps.email });
    }
    const mu = u.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]+)$/);
    if (mu) {
      const x = etat.users.get(mu[1]);
      if (!x) return rep(404, { msg: "User not found" });
      if (m === "PUT") { x.password = corps.password; return rep(200, { id: x.id }); }
      if (m === "DELETE") {
        etat.users.delete(x.id);
        etat.profils = etat.profils.filter((p) => p.id !== x.id);  // cascade
        return rep(200, {});
      }
    }
    const mr = u.pathname.match(/^\/rest\/v1\/(profils|classes)$/);
    if (mr) {
      const table = mr[1];
      if (m === "GET") return rep(200, filtrer(etat[table], u.searchParams));
      if (m === "POST") {
        if (table === "profils" && etat.profils.some((p) => p.identifiant === corps.identifiant)) return rep(409, { code: "23505" });
        etat[table].push(corps);
        return rep(201);
      }
      if (m === "DELETE") {
        const visees = filtrer(etat[table], u.searchParams);
        if (table === "classes" && visees.some((c) => etat.profils.some((p) => p.classe_id === c.id))) return rep(409, { code: "23001" });
        etat[table] = etat[table].filter((l) => !visees.includes(l));
        return rep(204);
      }
    }
    return rep(404, { message: "route inconnue " + m + " " + u.pathname });
  }
  function compte(role, champs) {
    const id = uid();
    etat.users.set(id, { id, email: champs.identifiant });
    etat.profils.push(Object.assign({ id, role, classe_id: null }, champs));
    const jeton = "jeton-" + id;
    etat.jetons.set(jeton, id);
    return { id, jeton };
  }
  function classe(profId, nom) {
    const c = { id: uid(), prof_id: profId, nom, annee: "2026-2027" };
    etat.classes.push(c);
    return c;
  }
  return { f, etat, compte, classe };
}

function monde(cle) {
  cle = cle || "sb_secret_essai";
  const s = fauxSupabase(cle);
  const profA = s.compte("prof", { prenom: "Anne", nom: "Prof", identifiant: "anne@exemple.fr" });
  const profB = s.compte("prof", { prenom: "Bruno", nom: "Prof", identifiant: "bruno@exemple.fr" });
  const classeA = s.classe(profA.id, "2A"), classeB = s.classe(profB.id, "2B");
  const lucas = s.compte("eleve", { prenom: "Lucas", nom: "Martin", identifiant: "lucas.martin", classe_id: classeA.id });
  const ines = s.compte("eleve", { prenom: "Inès", nom: "Bernard", identifiant: "ines.bernard", classe_id: classeB.id });
  const env = { url: "https://projet.supabase.co", cle };
  async function appeler(jeton, corps, init) {
    const headers = Object.assign({ Origin: ORIGINE, "Content-Type": "application/json" }, jeton ? { Authorization: "Bearer " + jeton } : {});
    const req = new Request("https://projet.supabase.co/functions/v1/gestion-eleves",
      Object.assign({ method: "POST", headers, body: typeof corps === "string" ? corps : JSON.stringify(corps) }, init));
    const r = await F.traiter(req, env, s.f);
    const texte = await r.text();
    return { status: r.status, corps: texte && texte !== "ok" ? JSON.parse(texte) : texte, entetes: r.headers };
  }
  return { s, env, profA, profB, classeA, classeB, lucas, ines, appeler };
}

// ---------- identifiants et mots de passe

test("identifiants : exemples de la trame, accents, apostrophes, espaces, doublons", () => {
  const pris = new Set();
  assert.equal(F.identifiantDe("Zoé", "D'ALMEIDA RUIZ", pris), "zoe.dalmeida-ruiz");
  assert.equal(F.identifiantDe("Jean Pierre", "Martin", pris), "jean-pierre.martin");
  assert.equal(F.identifiantDe("Lucas", "Martin", new Set(["lucas.martin"])), "lucas.martin2");
  assert.equal(F.identifiantDe("Lucas", "Martin", new Set(["lucas.martin", "lucas.martin2"])), "lucas.martin3");
  assert.equal(F.identifiantDe("Æsa", "Œuvray-Søren", pris), "aesa.oeuvray-soren");
  assert.equal(F.identifiantDe("  Éloïse ", " L’Hôte  ", pris), "eloise.lhote");
  assert.equal(F.identifiantDe("李", "王", pris), "eleve.eleve");
});

test("identifiants : 30 caractères au plus, chiffre compris, sans point ni tiret final", () => {
  const long = F.identifiantDe("Marie-Charlotte", "De La Fontaine-Beaumarchais", new Set());
  assert.equal(long, "marie-charlotte.de-la-fontaine");
  assert.ok(long.length <= 30);
  const suite = F.identifiantDe("Marie-Charlotte", "De La Fontaine-Beaumarchais", new Set([long]));
  assert.equal(suite, "marie-charlotte.de-la-fontain2");
  assert.equal(F.identifiantDe("Abcdefghijklmnopqrstuvwxyzabc", "Nom", new Set()), "abcdefghijklmnopqrstuvwxyzabc");
});

test("mots de passe : trois syllabes et deux chiffres, sans caractère ambigu", () => {
  assert.equal(F.motDePasse((n) => new Uint8Array(n)), "bababa22");
  assert.equal(F.motDePasse((n) => new Uint8Array(n).fill(255)), "zyzyzy99");
  const vus = new Set();
  for (let i = 0; i < 200; i++) { const m = F.motDePasse(); assert.match(m, MDP); vus.add(m); }
  assert.ok(vus.size > 190, "mots de passe trop souvent identiques");
});

// ---------- contrôle de l'appelant

test("préliminaires : CORS, méthode, configuration, JSON", async () => {
  const w = monde();
  const pre = await F.traiter(new Request("https://x/functions/v1/gestion-eleves", { method: "OPTIONS", headers: { Origin: ORIGINE } }), w.env, w.s.f);
  assert.equal(pre.status, 200);
  assert.equal(pre.headers.get("Access-Control-Allow-Origin"), ORIGINE);
  assert.match(pre.headers.get("Access-Control-Allow-Headers"), /authorization/);
  const etrangere = await F.traiter(new Request("https://x/f", { method: "OPTIONS", headers: { Origin: "https://pirate.example" } }), w.env, w.s.f);
  assert.equal(etrangere.headers.get("Access-Control-Allow-Origin"), ORIGINE);
  const locale = await F.traiter(new Request("https://x/f", { method: "OPTIONS", headers: { Origin: "http://localhost:8080" } }), w.env, w.s.f);
  assert.equal(locale.headers.get("Access-Control-Allow-Origin"), "http://localhost:8080");
  assert.equal((await F.traiter(new Request("https://x/f", { method: "GET" }), w.env, w.s.f)).status, 405);
  const sansCle = await F.traiter(new Request("https://x/f", { method: "POST", body: "{}" }), { url: w.env.url, cle: "" }, w.s.f);
  assert.equal(sansCle.status, 500);
  assert.match((await sansCle.json()).erreur, /clé de service absente/);
  const illisible = await w.appeler(w.profA.jeton, "pas du json");
  assert.equal(illisible.status, 400);
  assert.equal((await w.appeler(w.profA.jeton, { action: "rien" })).status, 400);
});

test("l'appelant doit être un prof connecté", async () => {
  const w = monde();
  const sans = await w.appeler(null, { action: "creer_eleves" });
  assert.equal(sans.status, 401);
  assert.equal(sans.corps.erreur, "Connexion requise.");
  assert.equal((await w.appeler("jeton-faux", { action: "creer_eleves" })).status, 401);
  const eleve = await w.appeler(w.lucas.jeton, { action: "creer_eleves", classe_id: w.classeA.id, eleves: [{ prenom: "A", nom: "B" }] });
  assert.equal(eleve.status, 403);
  assert.equal(eleve.corps.erreur, "Action réservée aux professeurs.");
});

// ---------- actions

test("creer_eleves : comptes sans mail envoyé, identifiants uniques, profils dans la classe", async () => {
  const w = monde();
  const r = await w.appeler(w.profA.jeton, { action: "creer_eleves", classe_id: w.classeA.id,
    eleves: [{ prenom: "Lucas", nom: "Martin" }, { prenom: " Zoé ", nom: "D'Almeida Ruiz" }, { prenom: "Lucas", nom: "MARTIN" }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corps.erreurs, []);
  assert.deepEqual(r.corps.eleves.map((e) => e.identifiant), ["lucas.martin2", "zoe.dalmeida-ruiz", "lucas.martin3"]);
  assert.deepEqual(r.corps.eleves.map((e) => e.prenom), ["Lucas", "Zoé", "Lucas"]);
  for (const e of r.corps.eleves) {
    assert.match(e.mot_de_passe, MDP);
    const u = w.s.etat.users.get(e.id);
    assert.equal(u.email, e.identifiant + "@eleves.invalid");
    assert.equal(u.password, e.mot_de_passe);
    assert.equal(u.email_confirm, true);
    const p = w.s.etat.profils.find((x) => x.id === e.id);
    assert.deepEqual([p.role, p.classe_id, p.identifiant], ["eleve", w.classeA.id, e.identifiant]);
  }
});

test("creer_eleves : compte orphelin déjà pris, classe d'un autre prof, liste invalide", async () => {
  const w = monde();
  w.s.etat.users.set("orphelin", { id: "orphelin", email: "lucas.martin2@eleves.invalid" });
  const r = await w.appeler(w.profA.jeton, { action: "creer_eleves", classe_id: w.classeA.id, eleves: [{ prenom: "Lucas", nom: "Martin" }] });
  assert.equal(r.corps.eleves[0].identifiant, "lucas.martin3");
  const autre = await w.appeler(w.profA.jeton, { action: "creer_eleves", classe_id: w.classeB.id, eleves: [{ prenom: "A", nom: "B" }] });
  assert.equal(autre.status, 403);
  const trop = Array.from({ length: 41 }, (_, i) => ({ prenom: "E" + i, nom: "N" }));
  assert.equal((await w.appeler(w.profA.jeton, { action: "creer_eleves", classe_id: w.classeA.id, eleves: trop })).status, 400);
  const vide = await w.appeler(w.profA.jeton, { action: "creer_eleves", classe_id: w.classeA.id, eleves: [{ prenom: "A", nom: "B" }, { prenom: "", nom: "C" }] });
  assert.equal(vide.status, 400);
  assert.match(vide.corps.erreur, /^Ligne 2 /);
  assert.equal((await w.appeler(w.profA.jeton, { action: "creer_eleves", classe_id: "pas-un-uuid", eleves: [] })).status, 400);
});

test("creer_eleves : un refus du service est rapporté ligne par ligne, sans compte orphelin", async () => {
  const w = monde();
  const f = w.s.f;
  w.s.f = async (url, init) => (/\/rest\/v1\/profils$/.test(new URL(url).pathname) && init.method === "POST"
    ? new Response(JSON.stringify({ code: "XX000" }), { status: 500 }) : f(url, init));
  const avant = w.s.etat.users.size;
  const r = await F.traiter(new Request("https://x/f", { method: "POST", headers: { Authorization: "Bearer " + w.profA.jeton },
    body: JSON.stringify({ action: "creer_eleves", classe_id: w.classeA.id, eleves: [{ prenom: "Tom", nom: "Petit" }] }) }), w.env, w.s.f);
  const corps = await r.json();
  assert.equal(r.status, 502);
  assert.deepEqual(corps.erreurs, [{ ligne: 1, prenom: "Tom", nom: "Petit", erreur: "création du profil refusée (statut 500)" }]);
  assert.equal(w.s.etat.users.size, avant);
});

test("reinitialiser : nouveau mot de passe pour un élève de ses classes seulement", async () => {
  const w = monde();
  const r = await w.appeler(w.profA.jeton, { action: "reinitialiser", eleve_id: w.lucas.id });
  assert.equal(r.status, 200);
  assert.equal(r.corps.identifiant, "lucas.martin");
  assert.match(r.corps.mot_de_passe, MDP);
  assert.equal(w.s.etat.users.get(w.lucas.id).password, r.corps.mot_de_passe);
  assert.equal((await w.appeler(w.profA.jeton, { action: "reinitialiser", eleve_id: w.ines.id })).status, 403);
  assert.equal((await w.appeler(w.profA.jeton, { action: "reinitialiser", eleve_id: w.profB.id })).status, 404);
});

test("supprimer_eleve et supprimer_classe : comptes effacés, puis la classe", async () => {
  const w = monde();
  assert.equal((await w.appeler(w.profA.jeton, { action: "supprimer_eleve", eleve_id: w.ines.id })).status, 403);
  const c = await w.appeler(w.profA.jeton, { action: "creer_eleves", classe_id: w.classeA.id,
    eleves: [{ prenom: "Tom", nom: "Petit" }, { prenom: "Léa", nom: "Roux" }] });
  const tom = c.corps.eleves[0].id;
  assert.deepEqual((await w.appeler(w.profA.jeton, { action: "supprimer_eleve", eleve_id: tom })).corps, { ok: true });
  assert.ok(!w.s.etat.users.has(tom));
  assert.equal((await w.appeler(w.profB.jeton, { action: "supprimer_classe", classe_id: w.classeA.id })).status, 403);
  const r = await w.appeler(w.profA.jeton, { action: "supprimer_classe", classe_id: w.classeA.id });
  assert.deepEqual(r.corps, { ok: true, eleves_supprimes: 2 });  // Lucas et Léa
  assert.ok(!w.s.etat.classes.some((x) => x.id === w.classeA.id));
  assert.ok(!w.s.etat.profils.some((p) => p.classe_id === w.classeA.id));
  assert.ok(w.s.etat.users.has(w.ines.id));
});

test("clé de service : une ancienne clé (jeton) va aussi dans Authorization, une clé sb_secret non", async () => {
  for (const [cle, attendu] of [["eyJancienne.cle", "Bearer eyJancienne.cle"], ["sb_secret_nouvelle", undefined]]) {
    const w = monde(cle);
    await w.appeler(w.profA.jeton, { action: "reinitialiser", eleve_id: w.lucas.id });
    const admin = w.s.etat.appels.find((a) => a.chemin.startsWith("/auth/v1/admin/"));
    assert.equal(admin.h.Authorization, attendu);
    const moi = w.s.etat.appels.find((a) => a.chemin === "/auth/v1/user");
    assert.equal(moi.h.Authorization, "Bearer " + w.profA.jeton);
  }
});
