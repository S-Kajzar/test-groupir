// Module commun module/suivi.js : configuration, session, accès aux données, file d'attente, backend de
// démonstration (règles d'accès de supabase/schema.sql), et équivalence avec la fonction gestion-eleves.
// Usage : node --test tests/suivi.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { chargerSuivi, chargerFonction, stockageMemoire } = require("./outils");

const SUPA = { url: "https://projet.supabase.co", cle: "sb_publishable_essai", depot: "habitat-durable" };
const pause = () => new Promise((r) => setTimeout(r, 5));
// les objets du module viennent de son bac à sable (autres prototypes) : on les compare par leur contenu
const egal = (a, b, message) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, message);

// module en démonstration, horloge réglable
function demo(options) {
  const h = { t: Date.parse("2026-10-21T08:00:00Z") };
  const m = chargerSuivi(Object.assign({ recherche: "?suivi=demo", maintenant: () => h.t }, options));
  m.h = h;
  return m;
}
function tentative(Suivi, champs) {
  return Object.assign({ id: Suivi.outils.uuid(), depot: "habitat-durable", activite: "isoler-paroi", mode: "entrainement",
    statut: "en_cours", debut: "2026-10-21T08:00:00.000Z", note20_provisoire: 12, detail: { items: [] } }, champs);
}

// ---------- configuration

test("sans configuration : module inactif, aucune requête", async () => {
  let appels = 0;
  const { Suivi } = chargerSuivi({ fetch: () => { appels++; } });
  assert.equal(Suivi.actif(), false);
  assert.equal(Suivi.utilisateur(), null);
  await assert.rejects(Suivi.connecter("lucas.martin", "demo"), { code: "inactif" });
  assert.equal(Suivi.enregistrerTentative(tentative(Suivi)), false);
  await Suivi.vider();
  assert.equal(appels, 0);
});

test("?suivi=demo active la démonstration et s'en souvient ; ?suivi=reel la quitte", () => {
  const stockage = stockageMemoire();
  assert.equal(chargerSuivi({ stockage, recherche: "?suivi=demo" }).Suivi.backend(), "demo");
  assert.equal(chargerSuivi({ stockage }).Suivi.backend(), "demo");
  assert.equal(chargerSuivi({ stockage, config: SUPA, recherche: "?suivi=reel" }).Suivi.backend(), "supabase");
  assert.equal(chargerSuivi({ stockage }).Suivi.backend(), null);
});

test("année scolaire : bascule fin août", () => {
  const { Suivi } = chargerSuivi();
  assert.equal(Suivi.outils.anneeScolaire(Date.parse("2026-10-21T08:00:00Z")), "2026-2027");
  assert.equal(Suivi.outils.anneeScolaire(Date.parse("2027-03-01T08:00:00Z")), "2026-2027");
  assert.equal(Suivi.outils.anneeScolaire(Date.parse("2027-08-25T08:00:00Z")), "2027-2028");
});

// ---------- session

test("connexion : élève et prof de démonstration, identifiant complété, refus clair", async () => {
  const { Suivi, ecouteurs } = demo();
  const vus = [];
  ecouteurs["suivi:session"] = [(ev) => vus.push(ev.detail && ev.detail.identifiant)];
  await assert.rejects(Suivi.connecter("lucas.martin", "faux"), { code: "identifiants", message: "Identifiant ou mot de passe incorrect." });
  await assert.rejects(Suivi.connecter("", ""), { code: "identifiants" });
  const u = await Suivi.connecter("  Lucas.Martin ", "demo");
  assert.equal(u.role, "eleve");
  assert.equal(`${u.prenom} ${u.nom}`, "Lucas Martin");
  assert.equal(u.classe.nom, "2A démo");
  assert.equal(u.classe.annee, "2026-2027");
  egal(vus, ["lucas.martin"]);
  await Suivi.deconnecter();
  assert.equal(Suivi.utilisateur(), null);
  egal(vus, ["lucas.martin", null]);
  const p = await Suivi.connecter("prof.demo", "demo");
  assert.equal(p.role, "prof");
  assert.equal(p.classe, null);
});

test("session : 2 h pour un élève, 12 h pour un prof", async () => {
  const m = demo();
  await m.Suivi.connecter("lucas.martin", "demo");
  m.h.t += 2 * 3600e3 - 1000;
  assert.ok(m.Suivi.utilisateur());
  m.h.t += 2000;
  assert.equal(m.Suivi.utilisateur(), null);
  await m.Suivi.connecter("prof.demo", "demo");
  m.h.t += 11 * 3600e3;
  assert.ok(m.Suivi.utilisateur());
  m.h.t += 3600e3 + 1000;
  assert.equal(m.Suivi.utilisateur(), null);
});

test("jeton rafraîchi à l'approche de son expiration, session gardée", async () => {
  const m = demo();
  await m.Suivi.connecter("lucas.martin", "demo");
  const avant = JSON.parse(m.stockage.getItem("suivi.session")).jeton;
  m.h.t += 59.5 * 60e3;
  assert.equal((await m.Suivi.lire("classes")).length, 1);
  const s = JSON.parse(m.stockage.getItem("suivi.session"));
  assert.notEqual(s.jeton, avant);
  assert.equal(s.limite, Date.parse("2026-10-21T10:00:00Z"));
  m.h.t += 60.2 * 60e3;  // nouveau jeton expiré, session encore valable (10 h 00) : rafraîchi au premier appel
  assert.equal((await m.Suivi.lire("classes")).length, 1);
});

// ---------- règles d'accès (démonstration)

test("démonstration : chacun ne lit que ce que la base lui permet", async () => {
  const m = demo();
  const S = m.Suivi;
  await S.connecter("lucas.martin", "demo");
  const t = tentative(S, { note20_provisoire: 14 });
  assert.equal(S.enregistrerTentative(t), true);
  await S.vider();
  assert.equal(S.etat().enAttente, 0);
  assert.equal((await S.lire("tentatives")).length, 1);
  egal((await S.lire("profils", { select: "identifiant" })).map((p) => p.identifiant), ["lucas.martin"]);
  await assert.rejects(S.inserer("classes", { nom: "Pirate", annee: "2026-2027" }), { code: "refus", status: 403 });
  await assert.rejects(S.inserer("tentatives", Object.assign(tentative(S), { eleve_id: "d0000000-0000-4000-8000-000000000012",
    classe_id: "d0000000-0000-4000-8000-0000000000c1" })), { code: "refus" });
  await S.deconnecter();

  await S.connecter("zoe.durand", "demo");
  egal(await S.lire("tentatives"), []);
  await S.deconnecter();

  await S.connecter("prof.demo", "demo");
  const vues = await S.lire("tentatives", { eleve_id: "eq.d0000000-0000-4000-8000-000000000011" });
  assert.equal(vues.length, 1);
  assert.equal(vues[0].note20_provisoire, 14);
  assert.equal(vues[0].version_module, S.version);
  const eleves = await S.lire("profils", { select: "identifiant", role: "eq.eleve", order: "identifiant.asc" });
  egal(eleves.map((p) => p.identifiant), ["lucas.martin", "zoe.durand"]);
  await assert.rejects(S.modifier("tentatives", { id: "eq." + t.id }, { note20: 20 }).then((r) => { if (!r.length) throw Object.assign(new Error("rien"), { code: "aucune" }); }), { code: "aucune" });
  const c = await S.inserer("classes", { nom: "1STI2D", annee: "2026-2027" });
  assert.equal(c[0].prof_id, "d0000000-0000-4000-8000-000000000001");
  assert.equal((await S.modifier("classes", { id: "eq." + c[0].id }, { nom: "1STI2D-G1" }))[0].nom, "1STI2D-G1");
  await assert.rejects(S.modifier("classes", { id: "eq." + c[0].id }, { prof_id: "x" }), { code: "refus" });
  await assert.rejects(S.modifier("classes", {}, { nom: "Tout" }), { code: "requete" });
});

test("une tentative remise ne change plus : le refus vide la file et reste noté", async () => {
  const m = demo();
  const S = m.Suivi;
  await S.connecter("lucas.martin", "demo");
  const t = tentative(S);
  S.enregistrerTentative(Object.assign({}, t, { statut: "remise", note20: 15, fin: "2026-10-21T08:40:00.000Z" }));
  await S.vider();
  S.enregistrerTentative(Object.assign({}, t, { statut: "en_cours", note20: 20 }));
  await S.vider();
  assert.equal(S.etat().enAttente, 0);
  assert.equal(S.etat().erreur, null);
  assert.equal(S.rejets()[0].statut, 409);
  assert.equal((await S.lire("tentatives"))[0].note20, 15);
  await assert.rejects(S.inserer("tentatives", Object.assign({}, t, { activite: "iti-ite" }), { upsert: true }), { status: 409 });
});

test("champs d'identité : une modification est refusée (400) et quitte la file", async () => {
  const S = demo().Suivi;
  await S.connecter("lucas.martin", "demo");
  const t = tentative(S);
  S.enregistrerTentative(t);
  await S.vider();
  S.enregistrerTentative(Object.assign({}, t, { mode: "examen" }));
  await S.vider();
  assert.equal(S.etat().enAttente, 0);
  assert.equal(S.rejets()[0].statut, 400);
  assert.match(S.etat().erreur, /ne se modifient pas/);
  assert.equal((await S.lire("tentatives"))[0].mode, "entrainement");
});

// ---------- file d'attente

test("hors ligne : la tentative attend, puis part au retour du réseau, sans doublon", async () => {
  const reseau = { ok: true };
  const m = demo({ enLigne: () => reseau.ok });
  const S = m.Suivi;
  await S.connecter("lucas.martin", "demo");
  reseau.ok = false;
  const t = tentative(S);
  S.enregistrerTentative(t);
  S.enregistrerTentative(Object.assign({}, t, { note20_provisoire: 16 }));
  await S.vider();
  assert.equal(S.etat().enAttente, 1);
  assert.match(S.etat().erreur, /Hors ligne/);
  reseau.ok = true;
  m.ecouteurs.online.forEach((f) => f());
  await pause();
  await S.vider();
  assert.equal(S.etat().enAttente, 0);
  const lignes = await S.lire("tentatives");
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0].note20_provisoire, 16);
});

test("poste partagé : la tentative d'un élève ne part qu'avec sa propre session", async () => {
  const reseau = { ok: true };
  const S = demo({ enLigne: () => reseau.ok }).Suivi;
  await S.connecter("lucas.martin", "demo");
  reseau.ok = false;
  S.enregistrerTentative(tentative(S));
  await S.deconnecter();
  reseau.ok = true;
  await S.connecter("zoe.durand", "demo");
  assert.equal(S.enregistrerTentative(Object.assign(tentative(S), {})), true);
  await S.vider();
  egal([S.etat().enAttente, S.etat().autres], [0, 1]);
  assert.equal((await S.lire("tentatives")).length, 1);  // celle de Zoé seulement
  await S.deconnecter();
  await S.connecter("lucas.martin", "demo");
  await S.vider();
  egal([S.etat().enAttente, S.etat().autres], [0, 0]);
  assert.equal((await S.lire("tentatives")).length, 1);
});

test("un prof ou un anonyme n'enregistre pas de tentative ; une tentative incomplète est refusée", async () => {
  const S = demo().Suivi;
  assert.equal(S.enregistrerTentative(tentative(S)), false);
  await S.connecter("prof.demo", "demo");
  assert.equal(S.enregistrerTentative(tentative(S)), false);
  await S.deconnecter();
  await S.connecter("lucas.martin", "demo");
  assert.throws(() => S.enregistrerTentative(tentative(S, { mode: "libre" })), { code: "requete" });
  assert.throws(() => S.enregistrerTentative(tentative(S, { id: "123" })), { code: "requete" });
});

// ---------- transport Supabase (fetch simulé)

function fauxFetch(reponses) {
  const appels = [];
  const f = async (url, init) => {
    const u = new URL(url), corps = init.body ? JSON.parse(init.body) : undefined;
    appels.push({ m: init.method, chemin: u.pathname + u.search, h: init.headers, corps, keepalive: init.keepalive });
    const r = await reponses(u, init, corps, appels.length);
    return new Response(r.d === undefined ? null : JSON.stringify(r.d), { status: r.s });
  };
  f.appels = appels;
  return f;
}
function supabaseSimule(options) {
  const o = Object.assign({ upsert: () => ({ s: 201 }) }, options);
  return fauxFetch((u, init, corps, n) => {
    if (u.pathname === "/auth/v1/token") return { s: 200, d: { access_token: "jeton-" + n, refresh_token: "r-" + n, expires_in: 3600, user: { id: "00000000-0000-4000-8000-0000000000a1" } } };
    if (u.pathname === "/rest/v1/profils") return { s: 200, d: [{ id: "00000000-0000-4000-8000-0000000000a1", role: "eleve", prenom: "Lucas", nom: "Martin", identifiant: "lucas.martin", classe_id: "00000000-0000-4000-8000-00000000c1a0" }] };
    if (u.pathname === "/rest/v1/classes") return { s: 200, d: [{ id: "00000000-0000-4000-8000-00000000c1a0", nom: "2A", annee: "2026-2027" }] };
    if (u.pathname === "/rest/v1/tentatives") return o.upsert(corps, n);
    if (u.pathname === "/rest/v1/rpc/ping") return { s: 200, d: "ok" };
    if (u.pathname === "/auth/v1/logout") return { s: 204 };
    return { s: 404, d: { message: "?" } };
  });
}

test("Supabase : adresses, en-têtes et corps des requêtes", async () => {
  const f = supabaseSimule();
  const { Suivi } = chargerSuivi({ config: SUPA, fetch: f });
  const u = await Suivi.connecter("lucas.martin", "bavume47");
  assert.equal(u.classe.nom, "2A");
  const [jeton, profil] = f.appels;
  assert.equal(jeton.chemin, "/auth/v1/token?grant_type=password");
  egal(jeton.corps, { email: "lucas.martin@eleves.invalid", password: "bavume47" });
  assert.equal(jeton.h.apikey, SUPA.cle);
  assert.equal(jeton.h.Authorization, undefined);  // clé « publishable » : pas dans Authorization
  assert.equal(profil.h.Authorization, "Bearer jeton-1");
  assert.equal(profil.chemin, "/rest/v1/profils?select=id%2Crole%2Cprenom%2Cnom%2Cidentifiant%2Cclasse_id&id=eq.00000000-0000-4000-8000-0000000000a1");
  const t = tentative(Suivi);
  Suivi.enregistrerTentative(t);
  await Suivi.vider();
  const envoi = f.appels.find((a) => a.chemin.startsWith("/rest/v1/tentatives"));
  assert.equal(envoi.chemin, "/rest/v1/tentatives?on_conflict=id");
  assert.equal(envoi.h.Prefer, "resolution=merge-duplicates,return=minimal");
  assert.equal(envoi.corps.eleve_id, "00000000-0000-4000-8000-0000000000a1");
  assert.equal(envoi.corps.classe_id, "00000000-0000-4000-8000-00000000c1a0");

  const ancienne = supabaseSimule();
  const m2 = chargerSuivi({ config: Object.assign({}, SUPA, { cle: "eyJancienne" }), fetch: ancienne });
  await m2.Suivi.appelBrut("POST", "/rest/v1/rpc/ping", { corps: {} });
  assert.equal(ancienne.appels[0].h.Authorization, "Bearer eyJancienne");
});

test("Supabase : erreur passagère gardée, refus définitif retiré, envoi d'urgence en keepalive", async () => {
  let reponse = { s: 503, d: { message: "indisponible" } };
  const f = supabaseSimule({ upsert: () => reponse });
  const { Suivi } = chargerSuivi({ config: SUPA, fetch: f });
  await Suivi.connecter("lucas.martin", "x");
  Suivi.enregistrerTentative(tentative(Suivi));
  await Suivi.vider();
  assert.equal(Suivi.etat().enAttente, 1);
  assert.equal(Suivi.etat().erreur, "indisponible");
  reponse = { s: 403, d: { code: "42501", message: "new row violates row-level security policy" } };
  await Suivi.vider({ urgence: true });
  assert.equal(Suivi.etat().enAttente, 0);
  assert.equal(Suivi.rejets()[0].statut, 403);
  assert.equal(f.appels.filter((a) => a.chemin.startsWith("/rest/v1/tentatives")).pop().keepalive, true);
});

test("Supabase : une tentative modifiée pendant son envoi repart avec sa dernière version", async () => {
  let liberer;
  const f = supabaseSimule({ upsert: (corps, n) => (f.appels.filter((a) => a.chemin.startsWith("/rest/v1/tentatives")).length === 1
    ? new Promise((r) => { liberer = () => r({ s: 201 }); }) : { s: 201 }) });
  const { Suivi } = chargerSuivi({ config: SUPA, fetch: f });
  await Suivi.connecter("lucas.martin", "x");
  const t = tentative(Suivi, { note20_provisoire: 10 });
  Suivi.enregistrerTentative(t);
  const envoi = Suivi.vider();
  await pause();
  Suivi.enregistrerTentative(Object.assign({}, t, { note20_provisoire: 18 }));
  liberer();
  await envoi;
  await Suivi.vider();
  const envois = f.appels.filter((a) => a.chemin.startsWith("/rest/v1/tentatives"));
  egal(envois.map((a) => a.corps.note20_provisoire), [10, 18]);
  assert.equal(Suivi.etat().enAttente, 0);
});

test("Supabase : jeton refusé (401) → rafraîchissement puis second essai ; échec → session close", async () => {
  let refus = 1;
  const f = supabaseSimule({ upsert: () => (refus-- > 0 ? { s: 401, d: { message: "JWT expired" } } : { s: 201 }) });
  const { Suivi } = chargerSuivi({ config: SUPA, fetch: f });
  await Suivi.connecter("lucas.martin", "x");
  Suivi.enregistrerTentative(tentative(Suivi));
  await Suivi.vider();
  assert.equal(Suivi.etat().enAttente, 0);
  assert.ok(f.appels.some((a) => a.chemin === "/auth/v1/token?grant_type=refresh_token"));

  const g = fauxFetch((u) => (u.pathname === "/auth/v1/token" && u.search.includes("refresh")
    ? { s: 400, d: { error_code: "refresh_token_not_found" } }
    : u.pathname === "/rest/v1/tentatives" ? { s: 401, d: {} } : supabaseSimule()(u.href, { method: "GET", headers: {} }).then((r) => r.json().then((d) => ({ s: r.status, d })))));
  const m = chargerSuivi({ config: SUPA, fetch: g });
  await m.Suivi.connecter("lucas.martin", "x");
  m.Suivi.enregistrerTentative(tentative(m.Suivi));
  await m.Suivi.vider();
  assert.equal(m.Suivi.utilisateur(), null);
  assert.equal(m.Suivi.etat().autres, 1);  // gardée pour la prochaine connexion de Lucas
});

// ---------- fonction gestion-eleves (démonstration) et équivalence avec index.ts

test("démonstration de gestion-eleves : créer, se connecter, réinitialiser, supprimer", async () => {
  const S = demo().Suivi;
  await S.connecter("lucas.martin", "demo");
  await assert.rejects(S.fonction("creer_eleves", {}), { status: 403, message: "Action réservée aux professeurs." });
  await S.deconnecter();
  await S.connecter("prof.demo", "demo");
  const classe = (await S.inserer("classes", { nom: "1STI2D", annee: "2026-2027" }))[0];
  const r = await S.fonction("creer_eleves", { classe_id: classe.id, eleves: [{ prenom: "Lucas", nom: "Martin" }, { prenom: "Inès", nom: "Bernard" }] });
  egal(r.eleves.map((e) => e.identifiant), ["lucas.martin2", "ines.bernard"]);
  await S.deconnecter();
  const ines = r.eleves[1];
  assert.equal((await S.connecter("ines.bernard", ines.mot_de_passe)).classe.nom, "1STI2D");
  await S.deconnecter();
  await S.connecter("prof.demo", "demo");
  const nouveau = await S.fonction("reinitialiser", { eleve_id: ines.id });
  assert.notEqual(nouveau.mot_de_passe, ines.mot_de_passe);
  await S.deconnecter();
  await assert.rejects(S.connecter("ines.bernard", ines.mot_de_passe), { code: "identifiants" });
  await S.connecter("ines.bernard", nouveau.mot_de_passe);
  await S.deconnecter();
  await S.connecter("prof.demo", "demo");
  egal(await S.fonction("supprimer_classe", { classe_id: classe.id }), { ok: true, eleves_supprimes: 2 });
  assert.equal((await S.lire("classes")).length, 1);
  await assert.rejects(S.fonction("inconnue", {}), { status: 400 });
});

test("identifiants et mots de passe : mêmes résultats que la fonction Supabase", async () => {
  const F = await chargerFonction();
  const { Suivi } = chargerSuivi();
  const corpus = [["Zoé", "D'ALMEIDA RUIZ"], ["Jean Pierre", "Martin"], ["Æsa", "Œuvray-Søren"], ["  Éloïse ", " L’Hôte  "],
    ["李", "王"], ["Marie-Charlotte", "De La Fontaine-Beaumarchais"], ["O'Neil", "N'Diaye"], ["Ana_Lu", "Da  Silva"]];
  const pris1 = new Set(["lucas.martin", "jean-pierre.martin"]), pris2 = new Set(pris1);
  for (const [p, n] of corpus.concat([["Lucas", "Martin"], ["Jean Pierre", "Martin"]])) {
    const a = F.identifiantDe(p, n, pris1), b = Suivi.outils.identifiantDe(p, n, pris2);
    assert.equal(b, a, p + " " + n);
    pris1.add(a); pris2.add(b);
  }
  for (let i = 0; i < 50; i++) {
    const o = Uint8Array.from({ length: 8 }, () => Math.floor(Math.random() * 256));
    assert.equal(Suivi.outils.motDePasse(() => o), F.motDePasse(() => o));
  }
});
