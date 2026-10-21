// Page de diagnostic (Playwright + Chromium) : le portail est servi en local, Supabase et le dépôt Habitat-durable
// sont simulés par interception des requêtes.
//   node --test tests/diagnostic.test.js   (navigateurs : npx playwright install chromium)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { RACINE } = require("./outils");

const PROJET = "https://projet-essai.supabase.co";
const CLE = "sb_publishable_essai";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json" };
let serveur, base, browser;

test.before(async () => {
  serveur = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!u.startsWith("/test-groupir/")) { res.writeHead(404); res.end(); return; }
    let f = path.normalize(path.join(RACINE, u.slice("/test-groupir/".length)));
    if (!f.startsWith(RACINE)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : fs.readFileSync(f));
  });
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + serveur.address().port;
  browser = await chromium.launch();
});
test.after(async () => { await browser.close(); serveur.close(); });

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
function repondre(route, status, corps) {
  return route.fulfill({ status, headers: Object.assign({ "content-type": "application/json" }, CORS),
    body: corps === undefined ? "" : JSON.stringify(corps) });
}

// supabase : (chemin, requête) → [statut, corps] ; habitat : statut de la page et catalogue éventuel
async function ouvrir(options) {
  const o = Object.assign({ supabase: null, catalogue: null, config: null, viewport: { width: 1280, height: 900 } }, options);
  const context = await browser.newContext({ viewport: o.viewport });
  const page = await context.newPage();
  const erreurs = [], appels = [];
  page.on("pageerror", (e) => erreurs.push(e.message));
  await page.route(PROJET + "/**", (route) => {
    const req = route.request(), u = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    appels.push({ m: req.method(), chemin: u.pathname, h: req.headers(), corps: req.postData() });
    if (o.supabase === "bloque") return route.abort("blockedbyclient");
    const r = o.supabase(u.pathname, req);
    return repondre(route, r[0], r[1]);
  });
  await page.route(base + "/Habitat-durable/**", (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("catalogue.json")) return o.catalogue ? repondre(route, 200, o.catalogue) : repondre(route, 404, {});
    return route.fulfill({ status: 200, contentType: "text/html", body: "<!DOCTYPE html><title>Habitat</title>" });
  });
  if (o.config) {
    await page.route(base + "/test-groupir/config.js", (route) => route.fulfill({ contentType: "text/javascript",
      body: "window.__SUIVI__ = " + JSON.stringify(o.config) + ";" }));
  }
  await page.goto(base + "/test-groupir/diagnostic.html");
  return { context, page, erreurs, appels };
}
const SAIN = (chemin) => {
  if (chemin === "/auth/v1/health") return [200, { name: "GoTrue" }];
  if (chemin === "/rest/v1/rpc/ping") return [200, "ok"];
  if (chemin === "/functions/v1/gestion-eleves") return [401, { erreur: "Connexion requise." }];
  return [404, {}];
};
async function lancer(page, url, cle) {
  await page.fill("#url", url);
  await page.fill("#cle", cle);
  await page.click("#lancer");
  await page.waitForFunction(() => !document.querySelector("#lancer").disabled && document.querySelector("#bilan").className !== "bilan");
}
const statuts = (page) => page.$$eval(".controle", (l) => Object.fromEntries(l.map((x) => [x.dataset.controle,
  x.querySelector(".pastille").className.replace("pastille ", "")])));
const conseil = (page, id) => page.locator(`.controle[data-controle=${id}] .conseil`).innerText();

test("tout va bien : lancé tout seul quand config.js est rempli, « Ce poste est prêt »", async () => {
  const { context, page, erreurs, appels } = await ouvrir({ supabase: SAIN, config: { url: PROJET, cle: CLE } });
  await page.waitForFunction(() => document.querySelector("#bilan").className.includes("ok"));
  assert.equal(await page.innerText("#bilan"), "Ce poste est prêt.");
  assert.deepEqual(await statuts(page), { navigateur: "ok", configuration: "ok", authentification: "ok", base: "ok",
    fonction: "ok", cours: "info", horloge: "ok" });
  assert.equal(await page.inputValue("#url"), PROJET);
  const sante = appels.find((a) => a.chemin === "/auth/v1/health");
  assert.equal(sante.h.apikey, CLE);
  assert.equal(sante.h.authorization, undefined);
  assert.match(await page.inputValue("#rapport"), /\[OK\] Base de données — schéma installé/);
  assert.doesNotMatch(await page.inputValue("#rapport"), new RegExp(CLE));
  assert.deepEqual(erreurs, []);
  await context.close();
});

test("catalogue Habitat publié : le contrôle du cours passe au vert", async () => {
  const { context, page } = await ouvrir({ supabase: SAIN, catalogue: { depot: "habitat-durable", activites: [{}, {}, {}] } });
  await lancer(page, PROJET, CLE);
  assert.equal((await statuts(page)).cours, "ok");
  assert.match(await page.innerText(".controle[data-controle=cours] .detail"), /3 activités/);
  await context.close();
});

test("réseau bloqué : problème signalé, conseil d'ouvrir *.supabase.co", async () => {
  const { context, page, erreurs } = await ouvrir({ supabase: "bloque" });
  await lancer(page, PROJET + "/", CLE);
  const s = await statuts(page);
  assert.deepEqual([s.authentification, s.base, s.fonction], ["ko", "ko", "ko"]);
  assert.match(await conseil(page, "authentification"), /\*\.supabase\.co \(HTTPS, port 443\)/);
  assert.match(await page.innerText("#bilan"), /^3 problèmes à résoudre\.$/);
  assert.deepEqual(erreurs, []);
  await context.close();
});

test("clé secrète collée : refusée, aucun appel au projet", async () => {
  const { context, page, appels } = await ouvrir({ supabase: SAIN });
  await lancer(page, PROJET, "sb_secret_abcdef");
  const s = await statuts(page);
  assert.equal(s.configuration, "ko");
  assert.equal(await page.innerText(".controle[data-controle=configuration] .detail"), "C'est la clé secrète.");
  assert.deepEqual([s.authentification, s.base, s.fonction, s.cours], ["info", "info", "info", "info"]);
  const jwtService = "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url") + ".sig";
  await lancer(page, PROJET, jwtService);
  assert.equal((await statuts(page)).configuration, "ko");
  assert.equal(appels.length, 0);
  await context.close();
});

test("schéma non installé, fonction absente : étapes à refaire indiquées", async () => {
  const { context, page } = await ouvrir({ supabase: (c) => (c === "/auth/v1/health" ? [200, {}]
    : c === "/rest/v1/rpc/ping" ? [404, { code: "PGRST202", message: "Could not find the function public.ping" }] : [404, {}]) });
  await lancer(page, PROJET, CLE);
  const s = await statuts(page);
  assert.deepEqual([s.authentification, s.base, s.fonction], ["ok", "ko", "ko"]);
  assert.match(await conseil(page, "base"), /schema\.sql.*étape 4/);
  assert.match(await conseil(page, "fonction"), /étape 5/);
  await context.close();
});

test("passerelle JWT active ou clé de service absente : conseils de l'étape 5", async () => {
  for (const [rep, statut, motif] of [[[401, { code: 401, message: "Missing authorization header" }], "attention", /vérification JWT/],
    [[500, { erreur: "Configuration de la fonction incomplète : clé de service absente (voir docs/INSTALLATION.md)." }], "ko", /CLE_SECRETE/]]) {
    const { context, page } = await ouvrir({ supabase: (c) => (c === "/functions/v1/gestion-eleves" ? rep : SAIN(c)) });
    await lancer(page, PROJET, CLE);
    assert.equal((await statuts(page)).fonction, statut);
    assert.match(await conseil(page, "fonction"), motif);
    await context.close();
  }
});

test("essai de connexion : compte reconnu puis déconnecté ; mauvais mot de passe expliqué", async () => {
  const profil = { id: "00000000-0000-4000-8000-00000000000a", role: "prof", prenom: "Anne", nom: "Prof", identifiant: "anne@exemple.fr", classe_id: null };
  const { context, page, erreurs, appels } = await ouvrir({ supabase: (c, req) => {
    if (c === "/auth/v1/token") return JSON.parse(req.postData()).password === "bon-mot-de-passe"
      ? [200, { access_token: "jeton", refresh_token: "r", expires_in: 3600, user: { id: profil.id } }]
      : [400, { error_code: "invalid_credentials", msg: "Invalid login credentials" }];
    if (c === "/rest/v1/profils") return [200, [profil]];
    if (c === "/auth/v1/logout") return [204];
    return SAIN(c);
  } });
  await page.fill("#url", PROJET);
  await page.fill("#cle", CLE);
  await page.fill("#identifiant", "anne@exemple.fr");
  await page.fill("#mdp", "faux");
  await page.click("#essayer");
  await page.waitForFunction(() => document.querySelector("#message-connexion").className.includes("ko"));
  assert.equal(await page.innerText("#message-connexion"), "Identifiant ou mot de passe incorrect.");
  await page.fill("#mdp", "bon-mot-de-passe");
  await page.click("#essayer");
  await page.waitForFunction(() => document.querySelector("#message-connexion").className.includes("ok"));
  assert.equal(await page.innerText("#message-connexion"), "Connexion réussie : Anne Prof (professeur). Déconnecté aussitôt.");
  assert.equal(await page.evaluate(() => localStorage.getItem("suivi.session")), null);
  assert.ok(appels.some((a) => a.chemin === "/auth/v1/logout"));
  assert.equal(await page.inputValue("#mdp"), "");
  assert.deepEqual(erreurs, []);
  await context.close();
});

test("démonstration : bandeau affiché, essai avec un compte de démonstration", async () => {
  const { context, page } = await ouvrir({ supabase: SAIN });
  await page.goto(base + "/test-groupir/diagnostic.html?suivi=demo");
  assert.ok(await page.isVisible("#bandeau-demo"));
  await page.fill("#identifiant", "lucas.martin");
  await page.fill("#mdp", "demo");
  await page.click("#essayer");
  await page.waitForFunction(() => document.querySelector("#message-connexion").className.includes("ok"));
  assert.match(await page.innerText("#message-connexion"), /Lucas Martin \(élève, classe 2A démo\)/);
  await context.close();
});

test("téléphone (375 px) : rien ne déborde", async () => {
  const { context, page } = await ouvrir({ supabase: SAIN, viewport: { width: 375, height: 800 } });
  await lancer(page, PROJET, CLE);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await context.close();
});
