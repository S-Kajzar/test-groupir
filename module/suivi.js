/* suivi.js 1.0.0 — module commun du suivi des élèves.
   Source de référence : dépôt test-groupir, module/suivi.js. Recopié à l'identique dans chaque dépôt de cours
   (empreinte SHA-256 vérifiée par leurs tests) : on ne modifie jamais une copie, on modifie la source puis on recopie.
   Rôle : session (connexion, expiration, déconnexion), accès à Supabase par fetch (authentification, base, fonction
   gestion-eleves), file d'attente des tentatives (envoi au retour du réseau), backend de démonstration.
   Configuration : window.__SUIVI__ = { url, cle, depot, portail } ; sans adresse ni clé, le module reste inactif.
   Démonstration : ?suivi=demo dans l'adresse (mémorisé dans le navigateur), ?suivi=reel pour en sortir. Tout y reste
   dans le navigateur ; comptes prof.demo, lucas.martin et zoe.durand, mot de passe « demo ».
   Évènements émis sur window : « suivi:session » (connexion, déconnexion), « suivi:etat » (file d'attente, envois). */
(function (racine) {
  "use strict";
  var VERSION = "1.0.0";
  var DOMAINE = "eleves.invalid";                 // adresse de connexion d'un élève : identifiant@eleves.invalid
  var DUREE_SESSION = { eleve: 2 * 3600e3, prof: 12 * 3600e3 };
  var MARGE_JETON = 60e3;                         // le jeton est rafraîchi une minute avant son expiration
  var PERIODE_ENVOI = 30e3;
  var DUREE_FILE = 30 * 24 * 3600e3;              // une tentative jamais envoyée est oubliée au bout de 30 jours
  var LIMITE_KEEPALIVE = 60000;                   // envoi à la fermeture de la page : corps de moins de 64 Ko
  var CLE = { session: "suivi.session", file: "suivi.file", rejets: "suivi.rejets", demo: "suivi.demo",
              base: "suivi.demo.base", horsLigne: "suivi.demo.horsligne" };
  var MESSAGES = {
    reseau: "Réseau indisponible ou service injoignable.",
    identifiants: "Identifiant ou mot de passe incorrect.",
    nonConfirme: "Compte non confirmé : coche « Auto Confirm User » à sa création (docs/INSTALLATION.md).",
    session: "Session terminée : reconnecte-toi.",
    profil: "Ce compte n'a pas de profil : demande à ton professeur.",
    trop: "Trop de connexions en peu de temps : patiente une minute.",
    inactif: "Suivi non configuré sur cette page.",
    horsLigne: "Hors ligne : envoi au retour du réseau."
  };
  var CHAMPS_TENTATIVE = ["id", "eleve_id", "classe_id", "depot", "activite", "mode", "statut", "debut", "fin", "duree_s",
    "note20", "note20_provisoire", "points", "points_max", "items_valides", "items_total", "detail", "version_module"];

  // ====================== OUTILS ======================
  function rien() {}
  function maintenant() {
    return typeof racine.__SUIVI_HORLOGE__ === "function" ? racine.__SUIVI_HORLOGE__() : Date.now();
  }
  function iso(ms) { return new Date(ms === undefined ? maintenant() : ms).toISOString(); }
  function erreur(code, message, status) {
    var e = new Error(message);
    e.code = code;
    if (status) e.status = status;
    return e;
  }
  function emettre(type, detail) {
    try { if (racine.dispatchEvent && racine.CustomEvent) racine.dispatchEvent(new racine.CustomEvent(type, { detail: detail })); }
    catch (e) { /* page sans évènements : rien à signaler */ }
  }
  function cloner(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  // stockage du navigateur, avec repli en mémoire s'il est refusé (navigation privée stricte, quota)
  var memoire = {}, panne = false;
  function stockage() {
    if (panne) return null;
    try { return racine.localStorage || null; } catch (e) { panne = true; return null; }
  }
  function lireBrut(cle) {
    var s = stockage();
    if (s) { try { return s.getItem(cle); } catch (e) { panne = true; } }
    return Object.prototype.hasOwnProperty.call(memoire, cle) ? memoire[cle] : null;
  }
  function ecrireBrut(cle, texte) {
    var s = stockage();
    if (s) { try { s.setItem(cle, texte); return; } catch (e) { panne = true; } }
    memoire[cle] = texte;
  }
  function effacer(cle) {
    delete memoire[cle];
    var s = stockage();
    if (s) { try { s.removeItem(cle); } catch (e) { panne = true; } }
  }
  function lire(cle) {
    var v = lireBrut(cle);
    if (v === null || v === undefined) return null;
    try { return JSON.parse(v); } catch (e) { return null; }
  }
  function ecrire(cle, valeur) { ecrireBrut(cle, JSON.stringify(valeur)); }

  function octets(n) {
    var o = new Uint8Array(n);
    if (racine.crypto && racine.crypto.getRandomValues) racine.crypto.getRandomValues(o);
    else for (var i = 0; i < n; i++) o[i] = Math.floor(Math.random() * 256);
    return o;
  }
  function uuid() {
    if (racine.crypto && typeof racine.crypto.randomUUID === "function") return racine.crypto.randomUUID();
    var o = octets(16);
    o[6] = (o[6] & 15) | 64; o[8] = (o[8] & 63) | 128;
    var h = Array.prototype.map.call(o, function (b) { return (b + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  // paramètres d'adresse de l'API REST (PostgREST) : { select: "id,nom", classe_id: "eq.…", order: "debut.desc" }
  function chaine(params) {
    var p = [];
    for (var k in params) {
      if (params[k] !== undefined && params[k] !== null) p.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
    }
    return p.length ? "?" + p.join("&") : "";
  }

  // année scolaire en cours, de la fin août à la fin juillet : « 2026-2027 »
  function anneeScolaire(ms) {
    var d = new Date(ms === undefined ? maintenant() : ms), a = d.getFullYear();
    return d.getMonth() >= 7 ? a + "-" + (a + 1) : (a - 1) + "-" + a;
  }

  // ====================== IDENTIFIANTS ET MOTS DE PASSE ======================
  // Copie conforme de supabase/functions/gestion-eleves/index.ts (tests/fonction.test.js compare les deux).
  function normaliser(texte) {
    return String(texte || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/æ/g, "ae").replace(/œ/g, "oe").replace(/ß/g, "ss").replace(/ø/g, "o").replace(/đ/g, "d")
      .replace(/ł/g, "l").replace(/ı/g, "i")
      .replace(/['’‘`´]/g, "").replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-").replace(/^-|-$/g, "");
  }
  function identifiantDe(prenom, nom, pris) {
    var base = ((normaliser(prenom) || "eleve") + "." + (normaliser(nom) || "eleve")).slice(0, 30).replace(/[.-]+$/, "");
    if (!pris.has(base)) return base;
    for (var i = 2; ; i++) {
      var s = String(i), essai = base.slice(0, 30 - s.length).replace(/[.-]+$/, "") + s;
      if (!pris.has(essai)) return essai;
    }
  }
  var CONSONNES = "bcdfghjkmnprstvz", VOYELLES = "aeuy", CHIFFRES = "23456789";
  function motDePasse(tirage) {
    var o = (tirage || octets)(8), m = "";
    for (var i = 0; i < 3; i++) m += CONSONNES[o[2 * i] & 15] + VOYELLES[o[2 * i + 1] & 3];
    return m + CHIFFRES[o[6] & 7] + CHIFFRES[o[7] & 7];
  }

  // ====================== CONFIGURATION ======================
  function config() { return racine.__SUIVI__ || {}; }
  function estDemo() { return lireBrut(CLE.demo) === "1"; }
  function nomBackend() {
    if (estDemo()) return "demo";
    var c = config();
    return c.url && c.cle ? "supabase" : null;
  }
  function projet() { return estDemo() ? "demo" : String(config().url || "").replace(/\/+$/, ""); }
  function transport() { return estDemo() ? transportDemo : transportSupabase; }

  (function () {
    try {
      var p = new racine.URLSearchParams((racine.location && racine.location.search) || "").get("suivi");
      if (p === "demo") ecrireBrut(CLE.demo, "1");
      else if (p === "reel") effacer(CLE.demo);
    } catch (e) { /* adresse illisible : réglage inchangé */ }
  })();

  // ====================== TRANSPORT SUPABASE ======================
  // appel(methode, chemin, { jeton, corps, prefer, keepalive }) → { status, donnees } ; réseau absent → erreur « reseau »
  var transportSupabase = {
    appel: function (methode, chemin, options) {
      var c = config(), o = options || {};
      var entetes = { apikey: c.cle, "Content-Type": "application/json" };
      if (o.jeton) entetes.Authorization = "Bearer " + o.jeton;
      else if (/^eyJ/.test(c.cle || "")) entetes.Authorization = "Bearer " + c.cle;  // ancienne clé publique (jeton)
      if (o.prefer) entetes.Prefer = o.prefer;
      var init = { method: methode, headers: entetes };
      if (o.corps !== undefined) init.body = JSON.stringify(o.corps);
      if (o.keepalive) init.keepalive = true;
      if (typeof racine.fetch !== "function") return Promise.reject(erreur("reseau", MESSAGES.reseau));
      return racine.fetch(String(c.url).replace(/\/+$/, "") + chemin, init).then(function (r) {
        return r.text().then(function (t) {
          var d = null;
          try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
          return { status: r.status, donnees: d };
        });
      }, function () { throw erreur("reseau", MESSAGES.reseau); });
    }
  };

  function erreurReponse(r) {
    var d = r.donnees && typeof r.donnees === "object" ? r.donnees : {};
    var message = d.erreur || d.message || d.msg || d.error_description || ("Erreur du service (statut " + r.status + ").");
    var code = r.status === 401 ? "session" : r.status === 403 ? "refus" : r.status === 409 ? "conflit"
      : r.status === 429 ? "trop" : r.status >= 500 ? "service" : "requete";
    var e = erreur(code, message, r.status);
    e.codeBase = d.code || d.error_code || null;
    return e;
  }
  function verifierStatut(r) {
    if (r.status >= 200 && r.status < 300) return r.donnees;
    throw erreurReponse(r);
  }

  // ====================== SESSION ======================
  function lireSession() {
    var s = lire(CLE.session);
    if (!s || s.backend !== nomBackend() || s.projet !== projet()) return null;
    if (maintenant() > s.limite) { finSession(); return null; }
    return s;
  }
  function utilisateurCourant() {
    var s = lireSession();
    return s ? s.utilisateur : null;
  }
  function enregistrerSession(d, utilisateur, ancienne) {
    var t = maintenant();
    var s = {
      backend: nomBackend(), projet: projet(), jeton: d.access_token, rafraichissement: d.refresh_token,
      expireA: t + (d.expires_in || 3600) * 1000,
      connecteLe: ancienne ? ancienne.connecteLe : t,
      limite: ancienne ? ancienne.limite : t + (DUREE_SESSION[utilisateur.role] || DUREE_SESSION.eleve),
      utilisateur: utilisateur
    };
    ecrire(CLE.session, s);
    return s;
  }
  function finSession() {
    var avait = lireBrut(CLE.session) !== null;
    effacer(CLE.session);
    if (avait) { emettre("suivi:session", null); emettreEtat(); }
  }

  var rafraichissementEnCours = null;
  function rafraichir() {
    if (rafraichissementEnCours) return rafraichissementEnCours;
    var s = lireSession();
    if (!s) return Promise.reject(erreur("session", MESSAGES.session));
    var p = transport().appel("POST", "/auth/v1/token?grant_type=refresh_token", { corps: { refresh_token: s.rafraichissement } })
      .then(function (r) {
        if (r.status >= 200 && r.status < 300 && r.donnees && r.donnees.access_token) {
          return enregistrerSession(r.donnees, s.utilisateur, s).jeton;
        }
        if (r.status === 400 || r.status === 401 || r.status === 403) {
          finSession();
          throw erreur("session", MESSAGES.session, r.status);
        }
        throw erreurReponse(r);
      });
    rafraichissementEnCours = p;
    function fin() { rafraichissementEnCours = null; }
    p.then(fin, fin);
    return p;
  }
  function jeton(force) {
    var s = lireSession();
    if (!s) return Promise.reject(erreur("session", MESSAGES.session));
    if (!force && s.expireA - maintenant() > MARGE_JETON) return Promise.resolve(s.jeton);
    return rafraichir();
  }
  // appel avec la session ; un 401 (jeton refusé) déclenche un rafraîchissement et un second essai
  function appelConnecte(methode, chemin, options) {
    return jeton(false).then(function (j) {
      return transport().appel(methode, chemin, Object.assign({}, options, { jeton: j })).then(function (r) {
        if (r.status !== 401) return r;
        return jeton(true).then(function (j2) {
          return transport().appel(methode, chemin, Object.assign({}, options, { jeton: j2 }));
        }).then(function (r2) {
          if (r2.status === 401) { finSession(); throw erreur("session", MESSAGES.session, 401); }
          return r2;
        });
      });
    });
  }

  function connecter(identifiant, mdp) {
    if (!nomBackend()) return Promise.reject(erreur("inactif", MESSAGES.inactif));
    var email = String(identifiant || "").trim().toLowerCase();
    if (!email || !mdp) return Promise.reject(erreur("identifiants", "Renseigne ton identifiant et ton mot de passe."));
    if (email.indexOf("@") < 0) email += "@" + DOMAINE;
    var T = transport(), d = null;
    return T.appel("POST", "/auth/v1/token?grant_type=password", { corps: { email: email, password: String(mdp) } })
      .then(function (r) {
        var code = r.donnees && (r.donnees.error_code || r.donnees.code);
        if (code === "email_not_confirmed") throw erreur("identifiants", MESSAGES.nonConfirme, r.status);
        if (r.status === 400 || r.status === 401) throw erreur("identifiants", MESSAGES.identifiants, r.status);
        if (r.status === 429) throw erreur("trop", MESSAGES.trop, 429);
        if (r.status < 200 || r.status >= 300 || !r.donnees || !r.donnees.access_token) throw erreurReponse(r);
        d = r.donnees;
        return T.appel("GET", "/rest/v1/profils" + chaine({ select: "id,role,prenom,nom,identifiant,classe_id",
          id: "eq." + (d.user && d.user.id) }), { jeton: d.access_token });
      })
      .then(function (r) {
        var p = verifierStatut(r);
        p = p && p[0];
        if (!p) {
          T.appel("POST", "/auth/v1/logout?scope=local", { jeton: d.access_token }).catch(rien);
          throw erreur("profil", MESSAGES.profil);
        }
        if (!p.classe_id) return [p, null];
        return T.appel("GET", "/rest/v1/classes" + chaine({ select: "id,nom,annee", id: "eq." + p.classe_id }),
          { jeton: d.access_token }).then(function (rc) {
          return [p, (rc.status === 200 && rc.donnees && rc.donnees[0]) || null];
        });
      })
      .then(function (pc) {
        var p = pc[0];
        var u = { id: p.id, role: p.role, prenom: p.prenom, nom: p.nom, identifiant: p.identifiant, classe: pc[1] };
        enregistrerSession(d, u, null);
        emettre("suivi:session", u);
        emettreEtat();
        planifierEnvoi();
        return u;
      });
  }

  // déconnexion : on tente d'abord de vider la file (3 s au plus), puis la session est révoquée côté Supabase
  function deconnecter() {
    var s = lireSession();
    if (!s) { finSession(); return Promise.resolve(); }
    var minuteur = null;
    var delai = new Promise(function (ok) { minuteur = racine.setTimeout(ok, 3000); });
    return Promise.race([viderFile().catch(rien), delai]).then(function () {
      racine.clearTimeout(minuteur);
      var s2 = lire(CLE.session) || s;
      return transport().appel("POST", "/auth/v1/logout?scope=local", { jeton: s2.jeton }).catch(rien);
    }).then(function () { finSession(); });
  }

  // ====================== ACCÈS AUX DONNÉES (portail) ======================
  function lireTable(table, params) {
    return appelConnecte("GET", "/rest/v1/" + table + chaine(Object.assign({ select: "*" }, params))).then(verifierStatut);
  }
  function inserer(table, lignes, options) {
    var o = options || {};
    var prefer = (o.upsert ? "resolution=merge-duplicates," : "") + (o.minimal ? "return=minimal" : "return=representation");
    return appelConnecte("POST", "/rest/v1/" + table + chaine(o.upsert ? { on_conflict: "id" } : {}),
      { corps: lignes, prefer: prefer }).then(verifierStatut);
  }
  function modifier(table, filtres, valeurs) {
    if (!filtres || !Object.keys(filtres).length) return Promise.reject(erreur("requete", "Modification sans filtre refusée."));
    return appelConnecte("PATCH", "/rest/v1/" + table + chaine(filtres), { corps: valeurs, prefer: "return=representation" })
      .then(verifierStatut);
  }
  function fonction(action, donnees) {
    return appelConnecte("POST", "/functions/v1/gestion-eleves", { corps: Object.assign({ action: action }, donnees) })
      .then(verifierStatut);
  }

  // ====================== FILE D'ATTENTE DES TENTATIVES ======================
  // suivi.file = { id: { t: tentative, rev, eleve, le, essais } } : la dernière version de chaque tentative.
  // Une tentative n'est envoyée qu'avec la session de son élève : jamais au nom d'un autre sur un poste partagé.
  var etatEnvoi = { envoiEnCours: false, dernierEnvoi: null, erreur: null };
  var envoi = null, relancer = false, planifie = null, minuterie = null;

  function lireFile() {
    var f = lire(CLE.file);
    return f && typeof f === "object" ? f : {};
  }
  function etat() {
    var u = utilisateurCourant(), f = lireFile(), n = 0, autres = 0;
    for (var id in f) { if (u && f[id].eleve === u.id) n++; else autres++; }
    return { actif: !!nomBackend(), backend: nomBackend(), connecte: !!u, enAttente: n, autres: autres,
      envoiEnCours: etatEnvoi.envoiEnCours, dernierEnvoi: etatEnvoi.dernierEnvoi, erreur: etatEnvoi.erreur };
  }
  function emettreEtat() { emettre("suivi:etat", etat()); }

  function enregistrerTentative(t) {
    var u = utilisateurCourant();
    if (!u || u.role !== "eleve" || !u.classe) return false;
    if (!t || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t.id) ||
        ["entrainement", "examen"].indexOf(t.mode) < 0 || !t.depot || !t.activite || !t.debut) {
      throw erreur("requete", "Tentative incomplète : id, depot, activite, mode et debut sont requis.");
    }
    var copie = {};
    CHAMPS_TENTATIVE.forEach(function (k) { if (t[k] !== undefined) copie[k] = cloner(t[k]); });
    copie.eleve_id = u.id;
    copie.classe_id = u.classe.id;
    copie.version_module = VERSION;
    if (!copie.statut) copie.statut = "en_cours";
    var f = lireFile(), e = f[copie.id] || { rev: 0, essais: 0 };
    if (e.eleve && e.eleve !== u.id) return false;
    e.t = copie; e.rev += 1; e.eleve = u.id; e.le = maintenant();
    f[copie.id] = e;
    ecrire(CLE.file, f);
    emettreEtat();
    surveiller();
    planifierEnvoi();
    return true;
  }

  function noterRejet(e, r) {
    var rejets = lire(CLE.rejets) || [];
    rejets.unshift({ le: iso(), id: e.t.id, activite: e.t.activite, statut: r.status, message: erreurReponse(r).message });
    ecrire(CLE.rejets, rejets.slice(0, 20));
  }

  function viderFile(options) {
    if (envoi) { relancer = true; return envoi; }
    var u = utilisateurCourant();
    if (!u || !nomBackend()) return Promise.resolve(etat());
    if (racine.navigator && racine.navigator.onLine === false) {
      if (etat().enAttente) etatEnvoi.erreur = MESSAGES.horsLigne;
      emettreEtat();
      return Promise.resolve(etat());
    }
    var urgence = !!(options && options.urgence);
    etatEnvoi.envoiEnCours = true;
    emettreEtat();

    function suivant() {
      var f = lireFile();
      var ids = Object.keys(f).filter(function (id) { return f[id].eleve === u.id; })
        .sort(function (a, b) { return f[a].le - f[b].le; });
      if (!ids.length) return Promise.resolve();   // l'erreur éventuelle reste affichée jusqu'au prochain envoi réussi
      var id = ids[0], e = f[id], rev = e.rev;
      var opts = { corps: e.t, prefer: "resolution=merge-duplicates,return=minimal",
        keepalive: urgence && JSON.stringify(e.t).length < LIMITE_KEEPALIVE };
      return appelConnecte("POST", "/rest/v1/tentatives?on_conflict=id", opts).then(function (r) {
        var f2 = lireFile();
        if (r.status >= 200 && r.status < 300) {
          if (f2[id] && f2[id].rev === rev) delete f2[id];   // modifiée pendant l'envoi : elle repart au tour suivant
          ecrire(CLE.file, f2);
          etatEnvoi.dernierEnvoi = maintenant();
          etatEnvoi.erreur = null;
          emettreEtat();
          return suivant();
        }
        if (r.status === 408 || r.status === 429 || r.status >= 500) {  // passager : on réessaiera
          if (f2[id]) { f2[id].essais = (f2[id].essais || 0) + 1; ecrire(CLE.file, f2); }
          etatEnvoi.erreur = erreurReponse(r).message;
          return undefined;
        }
        // refus définitif (déjà remise, champ non modifiable, règle d'accès) : la tentative quitte la file
        delete f2[id];
        ecrire(CLE.file, f2);
        noterRejet(e, r);
        etatEnvoi.erreur = r.status === 409 ? null : erreurReponse(r).message;
        emettreEtat();
        return suivant();
      }, function (err) {
        etatEnvoi.erreur = err.message;
        if (err.code !== "reseau" && err.code !== "session") throw err;
      });
    }

    function fin() {
      envoi = null;
      etatEnvoi.envoiEnCours = false;
      emettreEtat();
      surveiller();
      if (relancer) { relancer = false; planifierEnvoi(); }
      return etat();
    }
    envoi = suivant().then(fin, function (err) { fin(); throw err; });
    return envoi;
  }

  function planifierEnvoi() {
    if (planifie) return;
    planifie = racine.setTimeout(function () { planifie = null; viderFile().catch(rien); }, 0);
  }
  // nouvel essai toutes les 30 s tant que la file n'est pas vide
  function surveiller() {
    var n = etat().enAttente;
    if (n && !minuterie) minuterie = racine.setInterval(function () { viderFile().catch(rien); }, PERIODE_ENVOI);
    else if (!n && minuterie) { racine.clearInterval(minuterie); minuterie = null; }
  }

  // ====================== BACKEND DE DÉMONSTRATION ======================
  // Mêmes adresses et mêmes réponses que Supabase, données dans le navigateur (suivi.demo.base). Les règles
  // d'accès et le déclencheur de supabase/schema.sql y sont reproduits ; la fonction gestion-eleves aussi.
  var DEMO = {
    prof: "d0000000-0000-4000-8000-000000000001",
    classe: "d0000000-0000-4000-8000-0000000000c1",
    eleves: [["d0000000-0000-4000-8000-000000000011", "Lucas", "Martin", "lucas.martin"],
             ["d0000000-0000-4000-8000-000000000012", "Zoé", "Durand", "zoe.durand"]]
  };
  function baseDemo() {
    var b = lire(CLE.base);
    if (b && b.version === 1) return b;
    var t = iso();
    b = { version: 1, users: [], profils: [], classes: [], tentatives: [], jetons: {}, rafraichissements: {} };
    b.users.push({ id: DEMO.prof, email: "prof.demo@" + DOMAINE, mdp: "demo" });
    b.profils.push({ id: DEMO.prof, role: "prof", prenom: "Camille", nom: "Démo", identifiant: "prof.demo", classe_id: null, cree_le: t });
    b.classes.push({ id: DEMO.classe, prof_id: DEMO.prof, nom: "2A démo", annee: anneeScolaire(), cree_le: t });
    DEMO.eleves.forEach(function (e) {
      b.users.push({ id: e[0], email: e[3] + "@" + DOMAINE, mdp: "demo" });
      b.profils.push({ id: e[0], role: "eleve", prenom: e[1], nom: e[2], identifiant: e[3], classe_id: DEMO.classe, cree_le: t });
    });
    ecrire(CLE.base, b);
    return b;
  }

  function rep(status, donnees) { return { status: status, donnees: donnees === undefined ? null : donnees }; }
  function refusBase(status, code, message) { var e = new Error(message); e.reponse = rep(status, { code: code, message: message }); return e; }

  var transportDemo = {
    appel: function (methode, chemin, options) {
      var o = options || {};
      return new Promise(function (ok, ko) {
        if ((racine.navigator && racine.navigator.onLine === false) || lireBrut(CLE.horsLigne) === "1") {
          ko(erreur("reseau", MESSAGES.reseau));
          return;
        }
        var b = cloner(baseDemo()), r;   // travail sur une copie, gardée seulement si l'opération réussit
        try { r = demoTraiter(b, methode, chemin, o); }
        catch (e) { if (!e.reponse) throw e; r = e.reponse; }
        if (methode !== "GET" && r.status < 300) ecrire(CLE.base, b);
        ok({ status: r.status, donnees: cloner(r.donnees) });
      });
    }
  };

  function demoTraiter(b, methode, chemin, o) {
    var q = chemin.indexOf("?"), route = q < 0 ? chemin : chemin.slice(0, q);
    var params = new racine.URLSearchParams(q < 0 ? "" : chemin.slice(q + 1));
    var acces = o.jeton ? b.jetons[o.jeton] : null;
    var uid = acces && acces.expire > maintenant() ? acces.uid : (o.jeton ? false : null);  // false : jeton refusé
    if (route === "/auth/v1/health") return rep(200, { name: "GoTrue", description: "démonstration" });
    if (route === "/auth/v1/token") return demoJeton(b, params.get("grant_type"), o.corps || {});
    if (route === "/auth/v1/logout") {
      if (uid) for (var j in b.jetons) if (b.jetons[j].uid === uid) delete b.jetons[j];
      return rep(204);
    }
    if (route === "/auth/v1/user") return uid ? rep(200, { id: uid }) : rep(401, { msg: "invalid JWT" });
    if (uid === false) return rep(401, { code: "PGRST301", message: "JWT expired" });
    if (route === "/rest/v1/rpc/ping") return rep(200, "ok");
    if (route === "/functions/v1/gestion-eleves") return demoFonction(b, uid, o.corps || {});
    var m = route.match(/^\/rest\/v1\/(profils|classes|tentatives)$/);
    if (m) return demoRest(b, uid, methode, m[1], params, o);
    return rep(404, { message: "Adresse inconnue de la démonstration : " + route });
  }

  function demoJeton(b, type, corps) {
    var uid = null;
    if (type === "password") {
      var u = b.users.filter(function (x) { return x.email === corps.email && x.mdp === corps.password; })[0];
      if (!u) return rep(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" });
      uid = u.id;
    } else if (type === "refresh_token") {
      uid = b.rafraichissements[corps.refresh_token];
      if (!uid || !b.users.some(function (x) { return x.id === uid; })) {
        return rep(400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      }
      delete b.rafraichissements[corps.refresh_token];
    } else return rep(400, { msg: "grant_type inconnu" });
    var t = maintenant();
    for (var j in b.jetons) if (b.jetons[j].expire < t) delete b.jetons[j];
    var acces = "demo-" + uuid(), rafraichissement = "demo-r-" + uuid();
    b.jetons[acces] = { uid: uid, expire: t + 3600e3 };
    b.rafraichissements[rafraichissement] = uid;
    return rep(200, { access_token: acces, refresh_token: rafraichissement, expires_in: 3600, token_type: "bearer", user: { id: uid } });
  }

  // règles d'accès de supabase/schema.sql
  function demoProfil(b, uid) { return b.profils.filter(function (p) { return p.id === uid; })[0] || null; }
  function demoEstProf(b, uid) { var p = demoProfil(b, uid); return !!p && p.role === "prof"; }
  function demoMaClasse(b, uid) { var p = demoProfil(b, uid); return p ? p.classe_id : null; }
  function demoClassesDuProf(b, uid) {
    return b.classes.filter(function (c) { return c.prof_id === uid; }).map(function (c) { return c.id; });
  }
  var REGLES = {
    profils: {
      droits: ["GET"],
      lire: function (b, uid, l) { return l.id === uid || demoClassesDuProf(b, uid).indexOf(l.classe_id) >= 0; }
    },
    classes: {
      droits: ["GET", "POST", "PATCH"], colonnes: ["nom", "annee"],
      lire: function (b, uid, l) { return l.prof_id === uid || l.id === demoMaClasse(b, uid); },
      creer: function (b, uid, l) { return l.prof_id === uid && demoEstProf(b, uid); },
      modifier: function (b, uid, l) { return l.prof_id === uid; },
      verifier: function (b, uid, l) { return l.prof_id === uid; }
    },
    tentatives: {
      droits: ["GET", "POST", "PATCH"],
      lire: function (b, uid, l) { return l.eleve_id === uid || demoClassesDuProf(b, uid).indexOf(l.classe_id) >= 0; },
      creer: function (b, uid, l) { return l.eleve_id === uid && l.classe_id === demoMaClasse(b, uid); },
      modifier: function (b, uid, l) { return l.eleve_id === uid; },
      verifier: function (b, uid, l) { return l.eleve_id === uid && l.classe_id === demoMaClasse(b, uid); }
    }
  };
  var IMMUABLES = ["eleve_id", "classe_id", "depot", "activite", "mode", "debut"];

  function demoDefauts(table, l, uid) {
    if (table === "classes") {
      if (!l.id) l.id = uuid();
      if (!l.prof_id) l.prof_id = uid;
      if (!l.cree_le) l.cree_le = iso();
    }
    if (table === "tentatives") {
      if (!l.eleve_id) l.eleve_id = uid;
      if (!l.statut) l.statut = "en_cours";
      if (!l.detail) l.detail = {};
    }
    return l;
  }
  function demoDeclencheur(table, ancienne, nouvelle) {
    if (table !== "tentatives") return;
    if (ancienne) {
      if (ancienne.statut === "remise") throw refusBase(409, "PT409", "Tentative déjà remise : modification refusée.");
      IMMUABLES.forEach(function (k) {
        if (k in nouvelle && String(nouvelle[k]) !== String(ancienne[k]) &&
            !(k === "debut" && new Date(nouvelle[k]).getTime() === new Date(ancienne[k]).getTime())) {
          throw refusBase(400, "PT400", "Tentative : élève, classe, dépôt, activité, mode et début ne se modifient pas.");
        }
      });
    }
    nouvelle.maj_le = iso();
  }
  function demoContraintes(table, l) {
    var ok = true;
    if (table === "tentatives") {
      ok = ["entrainement", "examen"].indexOf(l.mode) >= 0 && ["en_cours", "remise"].indexOf(l.statut) >= 0 &&
        [l.note20, l.note20_provisoire].every(function (n) { return n === null || n === undefined || (n >= 0 && n <= 20); }) &&
        /^[a-z0-9-]{1,60}$/.test(l.depot || "") && /^[a-z0-9-]{1,60}$/.test(l.activite || "") && !!l.debut &&
        JSON.stringify(l.detail || {}).length <= 262144;
    }
    if (table === "classes") {
      ok = typeof l.nom === "string" && l.nom.trim().length >= 1 && l.nom.trim().length <= 40 && /^[0-9]{4}-[0-9]{4}$/.test(l.annee || "");
    }
    if (!ok) throw refusBase(400, "23514", "new row for relation \"" + table + "\" violates check constraint");
  }

  function demoFiltrer(lignes, params) {
    var reserves = ["select", "order", "limit", "offset", "on_conflict"];
    params.forEach(function (v, k) {
      if (reserves.indexOf(k) >= 0) return;
      var p = v.indexOf("."), op = v.slice(0, p), val = v.slice(p + 1);
      lignes = lignes.filter(function (l) {
        var x = l[k] === null || l[k] === undefined ? null : String(l[k]);
        if (op === "eq") return x === val;
        if (op === "neq") return x !== val;
        if (op === "is") return val === "null" ? x === null : x !== null;
        if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").map(function (s) { return s.replace(/^"|"$/g, ""); }).indexOf(x) >= 0;
        throw refusBase(400, "PGRST100", "Opérateur non pris en charge par la démonstration : " + op);
      });
    });
    var ordre = params.get("order");
    if (ordre) {
      var cles = ordre.split(",").map(function (s) { var t = s.split("."); return { col: t[0], desc: t[1] === "desc" }; });
      lignes.sort(function (a, b) {
        for (var i = 0; i < cles.length; i++) {
          var x = a[cles[i].col], y = b[cles[i].col];
          if (x === y) continue;
          var c = x === null || x === undefined ? 1 : y === null || y === undefined ? -1 : x < y ? -1 : 1;
          return cles[i].desc ? -c : c;
        }
        return 0;
      });
    }
    var debut = Number(params.get("offset")) || 0, limite = params.get("limit");
    return lignes.slice(debut, limite ? debut + Number(limite) : undefined);
  }
  function demoSelect(lignes, select) {
    if (!select || select === "*") return lignes;
    var cols = select.split(",").map(function (s) { return s.trim(); });
    return lignes.map(function (l) { var r = {}; cols.forEach(function (c) { r[c] = l[c] === undefined ? null : l[c]; }); return r; });
  }

  function demoRest(b, uid, methode, table, params, o) {
    var R = REGLES[table];
    if (!uid) throw refusBase(401, "42501", "permission denied for table " + table);
    if (R.droits.indexOf(methode) < 0) throw refusBase(403, "42501", "permission denied for table " + table);
    var representation = /return=representation/.test(o.prefer || "");
    if (methode === "GET") {
      return rep(200, demoSelect(demoFiltrer(b[table].filter(function (l) { return R.lire(b, uid, l); }), params), params.get("select")));
    }
    if (methode === "POST") {
      var entrees = Array.isArray(o.corps) ? o.corps : [o.corps];
      var upsert = params.get("on_conflict") === "id" && /merge-duplicates/.test(o.prefer || "");
      var resultats = entrees.map(function (entree) {
        var existante = entree && entree.id ? b[table].filter(function (l) { return l.id === entree.id; })[0] : null;
        if (existante && !upsert) throw refusBase(409, "23505", "duplicate key value violates unique constraint");
        if (existante) {
          if (!R.lire(b, uid, existante) || !R.modifier(b, uid, existante)) {
            throw refusBase(403, "42501", "new row violates row-level security policy (USING expression) for table \"" + table + "\"");
          }
          var nouvelle = Object.assign({}, existante, cloner(entree));
          demoDeclencheur(table, existante, nouvelle);
          if (!R.verifier(b, uid, nouvelle)) throw refusBase(403, "42501", "new row violates row-level security policy for table \"" + table + "\"");
          demoContraintes(table, nouvelle);
          b[table][b[table].indexOf(existante)] = nouvelle;
          return nouvelle;
        }
        var l = demoDefauts(table, cloner(entree) || {}, uid);
        if (!R.creer(b, uid, l)) throw refusBase(403, "42501", "new row violates row-level security policy for table \"" + table + "\"");
        demoDeclencheur(table, null, l);
        demoContraintes(table, l);
        b[table].push(l);
        return l;
      });
      return representation ? rep(201, resultats) : rep(201);
    }
    // PATCH : lignes visibles et modifiables qui répondent aux filtres
    var valeurs = o.corps || {};
    if (R.colonnes && Object.keys(valeurs).some(function (k) { return R.colonnes.indexOf(k) < 0; })) {
      throw refusBase(403, "42501", "permission denied for table " + table);
    }
    var visees = demoFiltrer(b[table].filter(function (l) { return R.lire(b, uid, l) && R.modifier(b, uid, l); }), params);
    var faites = visees.map(function (ancienne) {
      var nouvelle = Object.assign({}, ancienne, cloner(valeurs));
      demoDeclencheur(table, ancienne, nouvelle);
      if (!R.verifier(b, uid, nouvelle)) throw refusBase(403, "42501", "new row violates row-level security policy for table \"" + table + "\"");
      demoContraintes(table, nouvelle);
      b[table][b[table].indexOf(ancienne)] = nouvelle;
      return nouvelle;
    });
    return representation ? rep(200, faites) : rep(204);
  }

  // fonction gestion-eleves (mêmes contrôles et mêmes réponses que supabase/functions/gestion-eleves/index.ts)
  function demoFonction(b, uid, corps) {
    function refus(status, message) { return rep(status, { erreur: message }); }
    if (uid === null) return refus(401, "Connexion requise.");
    if (!demoEstProf(b, uid)) return refus(403, "Action réservée aux professeurs.");
    function classeDuProf(id) { return b.classes.filter(function (c) { return c.id === id && c.prof_id === uid; })[0] || null; }
    function supprimerCompte(id) {
      b.users = b.users.filter(function (u) { return u.id !== id; });
      b.profils = b.profils.filter(function (p) { return p.id !== id; });
      b.tentatives = b.tentatives.filter(function (t) { return t.eleve_id !== id; });
    }
    var eleve = corps.eleve_id ? demoProfil(b, corps.eleve_id) : null;
    switch (corps.action) {
      case "creer_eleves": {
        var classe = classeDuProf(corps.classe_id);
        if (!classe) return refus(403, "Classe introuvable, ou classe d'un autre professeur.");
        var liste = corps.eleves;
        if (!Array.isArray(liste) || !liste.length) return refus(400, "Liste d'élèves vide.");
        if (liste.length > 40) return refus(400, "Au plus 40 élèves par envoi.");
        for (var i = 0; i < liste.length; i++) {
          var p0 = liste[i] && typeof liste[i].prenom === "string" ? liste[i].prenom.trim() : "";
          var n0 = liste[i] && typeof liste[i].nom === "string" ? liste[i].nom.trim() : "";
          if (!p0 || !n0 || p0.length > 60 || n0.length > 60) {
            return refus(400, "Ligne " + (i + 1) + " : prénom ou nom manquant (60 caractères au plus).");
          }
        }
        var pris = new Set(b.profils.map(function (p) { return p.identifiant; }));
        var crees = liste.map(function (e) {
          var prenom = e.prenom.trim(), nom = e.nom.trim(), identifiant = identifiantDe(prenom, nom, pris);
          pris.add(identifiant);
          var id = uuid(), mdp = motDePasse();
          b.users.push({ id: id, email: identifiant + "@" + DOMAINE, mdp: mdp });
          b.profils.push({ id: id, role: "eleve", prenom: prenom, nom: nom, identifiant: identifiant, classe_id: classe.id, cree_le: iso() });
          return { id: id, prenom: prenom, nom: nom, identifiant: identifiant, mot_de_passe: mdp };
        });
        return rep(200, { eleves: crees, erreurs: [] });
      }
      case "reinitialiser":
      case "supprimer_eleve": {
        if (!eleve || eleve.role !== "eleve") return refus(404, "Élève introuvable.");
        if (!classeDuProf(eleve.classe_id)) return refus(403, "Classe introuvable, ou classe d'un autre professeur.");
        if (corps.action === "supprimer_eleve") { supprimerCompte(eleve.id); return rep(200, { ok: true }); }
        var nouveau = motDePasse();
        b.users.forEach(function (u) { if (u.id === eleve.id) u.mdp = nouveau; });
        return rep(200, { identifiant: eleve.identifiant, mot_de_passe: nouveau });
      }
      case "supprimer_classe": {
        var c = classeDuProf(corps.classe_id);
        if (!c) return refus(403, "Classe introuvable, ou classe d'un autre professeur.");
        var ids = b.profils.filter(function (p) { return p.classe_id === c.id; }).map(function (p) { return p.id; });
        ids.forEach(supprimerCompte);
        b.classes = b.classes.filter(function (x) { return x.id !== c.id; });
        b.tentatives = b.tentatives.filter(function (t) { return t.classe_id !== c.id; });
        return rep(200, { ok: true, eleves_supprimes: ids.length });
      }
      default:
        return refus(400, "Action inconnue : creer_eleves, reinitialiser, supprimer_eleve ou supprimer_classe.");
    }
  }

  // ====================== DÉMARRAGE ======================
  (function () {
    var f = lireFile(), limite = maintenant() - DUREE_FILE, change = false;
    for (var id in f) if (!(f[id].le > limite)) { delete f[id]; change = true; }
    if (change) ecrire(CLE.file, f);
    if (racine.addEventListener) {
      racine.addEventListener("online", function () { viderFile().catch(rien); });
      racine.addEventListener("pagehide", function () { if (etat().enAttente) viderFile({ urgence: true }).catch(rien); });
      racine.addEventListener("storage", function (ev) {  // connexion ou déconnexion dans un autre onglet
        if (ev && ev.key === CLE.session) { emettre("suivi:session", utilisateurCourant()); emettreEtat(); }
      });
    }
    if (utilisateurCourant() && etat().enAttente) { surveiller(); planifierEnvoi(); }
  })();

  var Suivi = {
    version: VERSION,
    domaine: DOMAINE,
    actif: function () { return !!nomBackend(); },
    backend: nomBackend,
    config: function () { return Object.assign({}, config()); },
    configurer: function (c) { racine.__SUIVI__ = Object.assign({}, config(), c); emettreEtat(); },
    utilisateur: utilisateurCourant,
    finDeSession: function () { var s = lireSession(); return s ? s.limite : null; },
    connecter: connecter,
    deconnecter: deconnecter,
    lire: lireTable,
    inserer: inserer,
    modifier: modifier,
    fonction: fonction,
    enregistrerTentative: enregistrerTentative,
    vider: viderFile,
    etat: etat,
    rejets: function () { return lire(CLE.rejets) || []; },
    appelBrut: function (methode, chemin, options) { return transport().appel(methode, chemin, options); },
    outils: { uuid: uuid, chaine: chaine, anneeScolaire: anneeScolaire, normaliser: normaliser,
              identifiantDe: identifiantDe, motDePasse: motDePasse },
    demo: {
      active: estDemo,
      activer: function (oui) { if (oui) ecrireBrut(CLE.demo, "1"); else effacer(CLE.demo); emettre("suivi:session", utilisateurCourant()); emettreEtat(); },
      reinitialiser: function () { if (estDemo()) finSession(); effacer(CLE.base); return baseDemo(); },
      horsLigne: function (oui) { if (oui) ecrireBrut(CLE.horsLigne, "1"); else effacer(CLE.horsLigne); },
      base: function () { return cloner(baseDemo()); }
    }
  };
  racine.Suivi = Suivi;
  if (typeof module !== "undefined" && module.exports) module.exports = Suivi;
})(typeof window !== "undefined" ? window : this);
