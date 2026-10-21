// Outils communs aux tests : chargement de la fonction Supabase (TypeScript) et du module suivi.js.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");

const RACINE = path.join(__dirname, "..");
const FONCTION = path.join(RACINE, "supabase", "functions", "gestion-eleves", "index.ts");
const SUIVI = path.join(RACINE, "module", "suivi.js");

// index.ts sans ses types, importé comme module (Node 22.13 ou plus récent)
async function chargerFonction() {
  const js = stripTypeScriptTypes(fs.readFileSync(FONCTION, "utf8"));
  return import("data:text/javascript," + encodeURIComponent(js));
}

// stockage du navigateur simulé
function stockageMemoire(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
    _carte: m,
  };
}

// suivi.js exécuté dans un bac à sable : window, localStorage, fetch, horloge et navigator fournis par le test
function chargerSuivi(options) {
  const o = Object.assign({ config: null, fetch: null, stockage: stockageMemoire(), maintenant: null, enLigne: true,
    recherche: "" }, options);
  const ecouteurs = {};
  const fenetre = {
    __SUIVI__: o.config,
    localStorage: o.stockage,
    location: { search: o.recherche, origin: "https://s-kajzar.github.io", pathname: "/test-groupir/" },
    navigator: { get onLine() { return typeof o.enLigne === "function" ? o.enLigne() : o.enLigne; } },
    addEventListener: (type, f) => { (ecouteurs[type] = ecouteurs[type] || []).push(f); },
    removeEventListener: () => {},
    dispatchEvent: (ev) => { (ecouteurs[ev.type] || []).forEach((f) => f(ev)); return true; },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    crypto: globalThis.crypto,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    URLSearchParams,
    __SUIVI_HORLOGE__: o.maintenant,
  };
  if (o.fetch) fenetre.fetch = o.fetch;
  fenetre.window = fenetre;
  const contexte = vm.createContext(fenetre);
  vm.runInContext(fs.readFileSync(SUIVI, "utf8"), contexte, { filename: "suivi.js" });
  return { Suivi: fenetre.Suivi, fenetre, ecouteurs, stockage: o.stockage };
}

module.exports = { RACINE, FONCTION, SUIVI, chargerFonction, chargerSuivi, stockageMemoire };
