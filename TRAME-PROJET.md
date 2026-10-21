# Suivi des élèves : trame projet de la V1

Ce document est le cahier des charges de la V1. Il fait foi : ce qui n'y est pas décrit n'est pas à faire, et une
contradiction avec le code se signale au lieu de se trancher seul. Le prompt à donner à Claude Code est dans
[`PROMPT-CLAUDE-CODE.md`](PROMPT-CLAUDE-CODE.md).

## 1. Résultat attendu

Les pages de cours et d'exercices (dépôts publiés par GitHub Pages) restent utilisables sans compte, exactement comme
aujourd'hui. Un élève qui se connecte voit ses résultats enregistrés. Le professeur dispose d'un portail : il crée ses
classes, distribue les identifiants, suit les notes et l'acquisition des compétences, classe par classe, élève par
élève, question par question.

- **test-groupir** devient le **portail** : connexion, espace prof, espace élève, module commun, schéma de la base.
- **Habitat-durable** est le **premier dépôt branché**. Les autres (Chaîne fonctionnelle, Frottement et roulement…)
  le seront en V2 avec le même module, sans rien réinventer.

## 2. Décisions retenues

| Code | Question | Décision V1 |
|---|---|---|
| A1 | Stockage | **Supabase** (base Postgres et authentification), offre gratuite, **région Europe** (Paris ou Francfort) |
| A2 | Budget, compte | Gratuit. Le compte et le projet Supabase sont créés par toi (guide fourni). Claude Code ne détient jamais la clé secrète (`service_role`) |
| A3 | Organisation | test-groupir = portail et source du module commun ; chaque dépôt de cours embarque une copie du module |
| A4 | Gabarit | **Non modifié** (son empreinte SHA-256 reste vérifiée). Le module est ajouté par `generer.py` et lit le moteur par `window.__app__` |
| A5 | Hors ligne | La page fonctionne sans réseau ; les résultats attendent dans le navigateur et partent au retour du réseau |
| B1 | Accès au contenu | Libre sans compte (mode anonyme inchangé) ; la connexion sert seulement à enregistrer |
| B2 | Comptes élèves | Créés par le prof : import d'une liste (copier-coller ou CSV), identifiants et mots de passe générés, fiches imprimables |
| B3 | Identifiant | Sans adresse mail : `prenom.nom` ; mot de passe généré ; réinitialisation par le prof |
| B4 | Profs | Toi seul en V1, mais la base accepte plusieurs profs (chacun ne voit que ses classes). Un compte prof se crée à la main (guide) |
| B5 | Volume | Jusqu'à 10 classes de 35 élèves |
| B6 | Groupes | Un élève appartient à une seule classe (une « classe » peut être un demi-groupe) |
| C1 | Activités | Exercices, QCM et études de cas (tout ce qui passe par le moteur du gabarit). Pas les quiz ni les jeux des cours |
| C2 | Détail | Note globale, note par partie, chaque item (résultat, points) **et la réponse écrite** de l'élève |
| C3 | Modes | Entraînement et examen enregistrés tous les deux, distingués partout |
| C4 | Tentatives | Toutes conservées. Celle qui compte : la **dernière remise**, à défaut la dernière en cours |
| C5 | Sauvegarde | Envoi au fil du travail (le prof voit le travail en cours) ; **pas de reprise** sur un autre poste en V1 |
| C6 | Tracés | L'auto-évaluation de l'élève compte telle quelle ; le dessin n'est pas enregistré |
| C7 | Temps | Début, fin, durée enregistrés |
| C8 | Triche | Correction dans le navigateur acceptée (usage formatif). Une copie remise ne peut plus être modifiée |
| D1 | Référentiel | Liste **provisoire** de compétences propre au dépôt (§ 6), à remplacer par ton référentiel officiel |
| D2 | Échelle | 4 niveaux : Non acquis, En cours, Acquis, Maîtrisé |
| D3 | Rattachement | Chaque partie d'un exercice porte une ou plusieurs compétences ; une question peut l'outrepasser |
| D4 | Calcul | Taux de réussite sur les items corrigés → seuils 40 / 60 / 80 % |
| D5 | Ajustement manuel | Non en V1 |
| E1 | Vues prof | Classes ; Notes (classe × activités) ; Compétences (classe × compétences) ; Analyse d'une activité ; Fiche élève ; copie détaillée |
| E2 | Travail donné | Non : accès libre en V1 |
| E3 | Exports | CSV (Excel français) des notes et des compétences |
| E4 | Fin d'année | Suppression d'une classe (comptes et données) par le prof |
| F1 | Vue élève | Ses cours, ses résultats, ses copies, ses compétences |
| F2 | Moyenne de classe | Jamais montrée à l'élève |
| F3 | Après connexion | Portail (« Mes cours ») ; retour automatique à la page d'où il venait s'il s'est connecté depuis un exercice |
| G1 | Données nominatives | Nom, prénom, classe ; ni mail, ni date de naissance |
| G2 | Hébergement, durée | Europe ; données d'une année scolaire supprimées au plus tard le 31 août suivant |
| G3 | Établissement | Modèles fournis : fiche de traitement pour le chef d'établissement et le délégué à la protection des données, note aux familles |
| G4 | Matériel, réseau | PC et tablettes ; page de **diagnostic** à lancer sur un poste du lycée avant tout usage |
| H1 | Rôle de test-groupir | Portail définitif, plus une zone `essai/` pour la recette avant de toucher au site en ligne d'Habitat-durable |
| H4 | Apparence | Charte des cours (variables `--beton`, `--jaune`, `--bleu`…, polices du gabarit) |
| H5 | Livraison | Une pull request par lot (§ 10), arrêt et compte rendu à la fin de chaque lot |
| H6 | Adresse | GitHub Pages : `https://s-kajzar.github.io/test-groupir/` et `https://s-kajzar.github.io/Habitat-durable/` |

## 3. Architecture

```
Navigateur de l'élève ou du prof
 ├─ https://s-kajzar.github.io/Habitat-durable/        page d'exercices (+ suivi.js + suivi-gabarit.js intégrés)
 ├─ https://s-kajzar.github.io/test-groupir/           portail : connexion, espace élève, espace prof
 │      même origine (s-kajzar.github.io) → une seule connexion vaut pour tous les dépôts
 └─ https://<projet>.supabase.co                        authentification, base, fonction gestion-eleves
```

- **Même origine.** Tous les dépôts sont servis par `s-kajzar.github.io`. La session, rangée dans le `localStorage`,
  est donc partagée : l'élève se connecte une fois sur le portail et reste connecté dans chaque cours. Si un nom de
  domaine personnalisé est un jour ajouté à un seul dépôt, ce principe tombe : c'est à signaler.
- **Aucune dépendance externe dans les pages.** Le module parle à Supabase avec `fetch` (API REST de
  l'authentification, de la base et des fonctions), sans la bibliothèque `supabase-js`. Pas de framework ni d'étape
  de construction : HTML, CSS et JavaScript simples, comme dans les dépôts de cours.
- **Configuration publique.** L'adresse du projet et sa clé publique (`anon` ou `publishable`) sont publiques par
  nature : la sécurité repose sur les règles d'accès de la base (§ 4). La clé `service_role` n'existe que dans la
  fonction Supabase, jamais dans un dépôt.
- **Backend de démonstration.** `suivi.js` a deux backends de même interface : `supabase` et `demo` (tout dans le
  `localStorage`, comptes de test pré-créés). Le backend de démonstration s'active par `?suivi=demo` ou la clé
  `localStorage["suivi.demo"] = "1"`. Il sert aux tests automatiques et aux essais sans réseau. Comme il n'envoie
  rien, l'activer en production est sans danger.

### Fichiers de test-groupir

| Chemin | Rôle |
|---|---|
| `index.html` | connexion (identifiant, mot de passe) ; redirige vers `eleve.html` ou `prof.html`, ou vers `?retour=` |
| `eleve.html`, `prof.html` | espaces élève et prof (§ 7) |
| `diagnostic.html` | test du poste et du réseau (§ 8) |
| `portail.css`, `portail.js` | charte et logique du portail |
| `module/suivi.js` | **source de référence** du client : session, file d'attente, accès REST, backend de démonstration |
| `module/suivi-gabarit.js` | **source de référence** du branchement au moteur du gabarit (§ 5) |
| `depots.json` | dépôts branchés : `[{"cle": "habitat-durable", "titre": "Habitat durable", "url": "../Habitat-durable/"}]` |
| `supabase/schema.sql` | tables, règles d'accès, déclencheurs : un seul fichier, ré-exécutable sans erreur |
| `supabase/functions/gestion-eleves/` | fonction de gestion des comptes (`index.ts`, et `identifiants.js` importable par Deno et Node) |
| `essai/habitat-durable/` | copie de la page Habitat générée depuis la branche, pour la recette (§ 10, lot 3) |
| `outils/verifier-rls.mjs` | contrôle des règles d'accès sur le vrai projet (§ 9) |
| `docs/` | `INSTALLATION.md`, `GUIDE-PROF.md`, `FICHE-TRAITEMENT.md`, `INFORMATION-FAMILLES.md` |
| `tests/` | tests Node et Playwright |
| `.github/workflows/static.yml` | publication Pages (copie de celui d'Habitat-durable) |
| `.github/workflows/maintien.yml` | appel tous les 3 jours pour éviter la mise en pause du projet gratuit (§ 8) |
| `README.md`, `NOTE-DE-LIVRAISON.md` | dans le style des dépôts de cours |

Les deux fichiers de `module/` sont recopiés **à l'identique** dans `Habitat-durable/src/`. Chaque dépôt vérifie leur
empreinte SHA-256 par un test, comme pour le gabarit. Chaque fichier commence par un numéro de version
(`/* suivi.js 1.0.0 */`), qui est envoyé avec chaque tentative.

## 4. Base de données

### Tables

**`profils`** : une ligne par compte.
`id` (uuid, clé, = `auth.users.id`, suppression en cascade) · `role` (`prof` | `eleve`) · `prenom` · `nom` ·
`identifiant` (unique) · `classe_id` (élèves seulement, → `classes`) · `cree_le`.

**`classes`** : `id` · `prof_id` (→ `profils`) · `nom` (ex. « 2A », « 1STI2D-G1 ») · `annee` (ex. « 2026-2027 ») ·
`cree_le` · unicité (`prof_id`, `nom`, `annee`).

**`tentatives`** : une ligne par tentative d'une activité.

| Colonne | Contenu |
|---|---|
| `id` | uuid **généré par le navigateur** : un envoi répété ne crée pas de doublon |
| `eleve_id`, `classe_id` | auteur, et sa classe au moment de la tentative |
| `depot`, `activite` | ex. `habitat-durable`, `isoler-paroi` (la clé `?ex=`) |
| `mode` | `entrainement` \| `examen` |
| `statut` | `en_cours` \| `remise` |
| `debut`, `fin`, `duree_s` | `fin` reste vide tant que la tentative est en cours |
| `note20` | note finale pondérée du moteur (items non validés comptés zéro), vide en examen non remis |
| `note20_provisoire` | note pondérée sur les seuls items validés (bandeau du moteur) |
| `points`, `points_max`, `items_valides`, `items_total` | totaux |
| `detail` | JSON (≤ 256 Ko) : `parties` `[{num, titre, note20}]`, `items` `[{id, label, partie, type, pts, valide, score, reponse}]` (`type` : `question`, `case` d'une question à plusieurs cases, `trace`) ; `reponse` tronquée à 500 caractères ; `score` entre 0 et 1 |
| `version_module`, `maj_le` | version de `suivi.js` ; date de dernière écriture (déclencheur) |

### Règles d'accès (RLS activée sur les trois tables)

| Table | Élève | Prof |
|---|---|---|
| `profils` | lit sa ligne | lit sa ligne et celles des élèves de ses classes |
| `classes` | lit sa classe | lit, crée et renomme ses classes ; suppression par la fonction seulement |
| `tentatives` | crée les siennes (`eleve_id` = lui, `classe_id` = sa classe) ; les modifie **tant que `statut` = `en_cours`** ; les lit | lit celles de ses classes ; n'écrit rien |

- Un déclencheur refuse toute modification d'une tentative remise, ainsi que toute modification de `eleve_id`,
  `classe_id`, `depot`, `activite`, `mode` et `debut`.
- Personne ne supprime une tentative directement : elle disparaît avec le compte de l'élève (cascade).
- Les politiques sur `profils` passent par des fonctions `security definer` (`est_prof()`, `classe_de()`…) pour
  éviter les politiques récursives.
- Les inscriptions publiques sont **désactivées** dans Supabase : seule la fonction crée des comptes.

### Fonction `gestion-eleves` (Supabase Edge Function, TypeScript)

Elle vérifie le jeton de l'appelant, qu'il est prof et que la classe visée est la sienne. Elle répond en JSON, avec
des erreurs en français (`{"erreur": "…"}`). Elle autorise l'origine `https://s-kajzar.github.io`.

| Action | Entrée | Sortie |
|---|---|---|
| `creer_eleves` | `classe_id`, `eleves: [{prenom, nom}]` (40 au plus) | `[{id, prenom, nom, identifiant, mot_de_passe}]` |
| `reinitialiser` | `eleve_id` | `{identifiant, mot_de_passe}` |
| `supprimer_eleve` | `eleve_id` | `{ok: true}` |
| `supprimer_classe` | `classe_id` | `{ok: true, eleves_supprimes: n}` |

- **Identifiant** : `prenom.nom` en minuscules, sans accents ni apostrophes, espaces changés en tirets, 30 caractères
  au plus, suivi d'un chiffre en cas de doublon. Exemples : Zoé D'ALMEIDA RUIZ → `zoe.dalmeida-ruiz` ; Jean Pierre
  Martin → `jean-pierre.martin` ; un second Lucas Martin → `lucas.martin2`.
- **Adresse de connexion** : `identifiant@eleves.invalid`. C'est un domaine réservé, qui ne reçoit jamais de mail. Le
  compte est créé par l'API d'administration avec `email_confirm: true` : aucun mail n'est envoyé. Si Supabase refuse
  ce domaine au premier essai réel, Claude Code s'arrête et propose un remplacement.
- **Mot de passe** : trois syllabes et deux chiffres, sans caractères ambigus (ni `0 o 1 l i`), par exemple
  `bavume47`. Il est affiché une seule fois, sur les fiches à imprimer, et n'est conservé nulle part ailleurs.
- **Compte prof** : créé par toi dans le tableau de bord Supabase, avec une vraie adresse et un mot de passe de
  12 caractères au moins, puis déclaré prof par une ligne SQL fournie dans `docs/INSTALLATION.md`.

## 5. Branchement dans Habitat-durable

**Rien ne change pour un élève non connecté** : même page, même comportement, **aucune requête réseau** (vérifié par
un test). Un module sans configuration (adresse vide) reste entièrement inactif.

### Modifications du dépôt

- `src/suivi.js` et `src/suivi-gabarit.js` : copies conformes, intégrées en ligne en fin de page par `generer.py`
  (la page reste un fichier unique, utilisable hors ligne). Leur empreinte est contrôlée par les tests.
- `generer.py` :
  - constante `SUIVI_CONFIG` → `window.__SUIVI__ = {url, cle, depot: "habitat-durable", portail: "../test-groupir/"}` ;
  - liste `COMPETENCES` et champ `comp` des parties (§ 6) ;
  - écriture de **`catalogue.json`** à côté d'`index.html` ;
  - deux variantes des phrases « Rien n'est enregistré… » (lignes 539 et 1946 actuelles), en classes
    `only-anonyme` / `only-connecte` ; la variante connectée dit « Tes résultats sont enregistrés au nom de … ».
- `src/gabarit-exercice-interactif.html` : **inchangé**.
- Tests, `README.md`, `NOTE-DE-LIVRAISON.md` mis à jour.

### `catalogue.json` (lu par le portail)

```json
{"depot": "habitat-durable", "titre": "Habitat durable", "version": "…",
 "competences": [{"code": "HD3", "libelle": "Calculer les performances thermiques d'une paroi"}],
 "activites": [{"cle": "isoler-paroi", "tag": "Exercice 1.2", "titre": "Isoler une paroi", "type": "exercice",
   "niveau": "Niveau 1", "minutes": 45, "url": "?ex=isoler-paroi",
   "parties": [{"num": "1", "titre": "Les matériaux du mur", "minutes": 10}],
   "items": [{"id": "b1_1", "label": "Q1.1", "partie": "1", "type": "question", "pts": 1, "competences": ["HD4"]}]}]}
```

`type` vaut `exercice`, `qcm` ou `etude`. Les `id` des items sont ceux du moteur (clés de `__app__.state`,
`__QCFG__` et `__SKCFG__`) : catalogue et tentatives emploient les mêmes.

### Comportement de `suivi-gabarit.js` (élève connecté, exercice ouvert)

| Moment | Détection | Envoi |
|---|---|---|
| Choix du mode | classe `mode-training` ou `mode-exam` ajoutée à `body` (observateur) | nouvelle tentative `en_cours` |
| Entraînement : chaque validation | changement de `#score-count` (observateur), attente de 2 s | mise à jour |
| Entraînement : tout est validé | tous les items de `__QCFG__` et `__SKCFG__` validés | `statut = remise`, `fin` |
| Examen : composition | réponses lues dans les champs `.q[data-q] .q-input` et des questions à plusieurs cases, toutes les 60 s si elles ont changé, et à la fermeture de la page | mise à jour (sans note) |
| Examen : remise | clic sur `#exam-submit` puis `__app__.isGraded()` vrai | `statut = remise`, notes, `fin` |

- Les notes viennent du moteur lui-même, jamais d'un second calcul : `__app__.partStats()`,
  `__app__.weighted(stats, false)` pour `note20` et `weighted(stats, true)` pour `note20_provisoire`.
  `__app__.elapsedMs()` donne la durée. Un test vérifie que la note enregistrée égale la note affichée.
- **Écran du choix du mode** : « Tes résultats seront enregistrés au nom de **Lucas Martin (2A)**. Ce n'est pas toi ?
  Se déconnecter. » Le champ `#nom-eleve` est pré-rempli et verrouillé.
- **Bandeau fin en haut de page** : nom, classe, état de l'envoi (« Enregistré à 10 h 42 », « En attente d'envoi
  (2) », « Erreur : … »), bouton « Se déconnecter ». Il ne recouvre ni le rail des documents (bord droit) ni le
  bandeau de note (bas).
- **Non connecté** : un seul lien discret, au-dessus du choix du mode et sur l'accueil : « Se connecter pour
  enregistrer tes résultats », vers `portail + "?retour=" + adresse de la page`.
- Un rechargement de la page démarre une nouvelle tentative : l'ancienne reste « en cours » avec ce qu'elle contient.

## 6. Compétences

- `COMPETENCES` dans `generer.py` : liste de `(code, libellé)`. Chaque partie porte `"comp": ["HD3"]`, et un bloc
  peut l'outrepasser par `comp=[…]`. Un test exige que chaque item ait au moins une compétence et que chaque code
  existe.
- **Liste provisoire**, marquée « à valider » dans la note de livraison :

| Code | Libellé | Parties visées (à confirmer) |
|---|---|---|
| HD1 | Lire et exploiter un dossier de plans | Exercice 1.1, parties 1 à 5 |
| HD2 | Analyser la conception bioclimatique d'un logement | 1.1 partie 6 ; Étude 1 parties 1 et 2 |
| HD3 | Calculer les performances thermiques d'une paroi (R, U, déperditions, ponts thermiques, DJU) | 1.2 parties 2 et 3 ; 2.1 parties 2 et 3 |
| HD4 | Choisir et justifier une solution technique (isolant, ITI ou ITE, vitrage, chauffage) | 1.2 parties 1 et 4 ; 2.1 parties 1, 4, 5 et 6 ; Étude 1 parties 3 et 4 |
| HD5 | Évaluer la performance énergétique et environnementale (RE2020, production) | Étude 1 parties 5 et 6 ; QCM 1.3 réparti par thème |

- **Calcul** (fonction pure `calculerAcquisitions`, testée) : pour un élève et une compétence, on retient la
  tentative qui compte par activité (C4), puis ses items **validés** liés à la compétence.
  Taux = Σ (score × pts) / Σ pts.
  - Moins de 3 points possibles : « — » (pas assez d'éléments).
  - Sinon : < 40 % **NA** Non acquis (rouge) · 40–60 % **EC** En cours (orange) · 60–80 % **A** Acquis (vert
    clair) · ≥ 80 % **M** Maîtrisé (vert).
  - Les seuils sont dans une seule constante. La lettre est toujours affichée avec la couleur.
- Notes /20, mêmes seuils : < 8 rouge · 8–12 orange · 12–16 vert clair · ≥ 16 vert.

## 7. Portail, écran par écran

Le texte est en français et les identifiants de code aussi, comme dans les dépôts de cours. L'espace élève fonctionne
dès 360 px de large. L'espace prof est conçu pour 1 024 px et reste utilisable sur tablette (tableaux défilants,
première colonne fixe).

**Connexion (`index.html`)** : champs « Identifiant » et « Mot de passe ». Un identifiant sans `@` est complété par
`@eleves.invalid`. Messages clairs (« Identifiant ou mot de passe incorrect », « Service injoignable : lance le
diagnostic »). `?retour=` n'accepte qu'une adresse relative de la même origine. Lien vers le diagnostic.

**Sessions** : celle d'un élève expire **2 h** après la connexion, celle d'un prof 12 h. « Se déconnecter » révoque
la session côté Supabase. Sur un poste partagé, le nom affiché en permanence évite d'écrire au nom de l'élève
précédent.

**Espace élève (`eleve.html`)**
- *Mes cours* : une carte par dépôt de `depots.json`.
- *Mes résultats* : par activité, la tentative qui compte (note, mode, date, nombre de tentatives). Un clic ouvre la
  copie : chaque item avec sa réponse et son résultat (juste, demi-point, faux, non répondu).
- *Mes compétences* : chaque compétence avec son niveau. Jamais de moyenne ni de comparaison avec la classe.

**Espace prof (`prof.html`)**, en onglets :
1. **Classes** : liste (nom, année, nombre d'élèves).
   - *Créer une classe*.
   - *Importer des élèves* : coller depuis un tableur, ou fichier CSV. Les colonnes « nom » et « prénom » sont
     reconnues, avec ou sans en-tête, séparées par `;`, `,` ou une tabulation. La forme Pronote « NOM Prénom » est
     reconnue aussi : les mots en majuscules forment le nom. Un aperçu permet de retirer des lignes avant la
     création.
   - Après création : **fiches à imprimer** (A4, 10 par page). Chaque fiche porte l'adresse du portail, le nom, la
     classe, l'identifiant, le mot de passe et la mention « Garde ce papier : ton mot de passe ne sera plus
     affiché ».
   - Par élève : *Réinitialiser le mot de passe* (nouvelle fiche), *Retirer l'élève*.
   - *Supprimer la classe* : il faut retaper son nom ; comptes et données sont effacés.
2. **Notes** : choix de la classe et du dépôt, puis tableau élèves × activités (ordre du catalogue).
   - Une case montre la note /20 en couleur, la pastille *Ex.* ou *Ent.* et « en cours » en gris.
   - Une ligne donne la moyenne de chaque activité.
   - Un clic sur une case ouvre la **copie** : notes par partie, chaque item avec la réponse de l'élève, le résultat
     et les points, et la liste de ses autres tentatives à consulter.
   - Actualisation automatique toutes les 60 s (suivi en séance) et bouton « Actualiser ». Export CSV.
3. **Compétences** : tableau élèves × compétences (lettre, couleur, %). Un clic montre les items qui comptent.
   Export CSV.
4. **Analyse** : choix d'une activité. Tableau de ses items (libellé, partie, compétence, taux de réussite, nombre de
   réponses), triable, les items sous 40 % mis en évidence.
5. **Fiche élève** (clic sur un nom) : toutes ses tentatives, ses compétences.

**Exports CSV** : séparateur `;`, UTF-8 avec BOM, virgule décimale (ouverture directe dans Excel en français).

## 8. Hors ligne, réseau, sécurité, exploitation

- **File d'attente** : la dernière version de chaque tentative est gardée dans `localStorage["suivi.file"]`. Elle est
  renvoyée au retour du réseau (`online`), toutes les 30 s et au chargement suivant. L'envoi utilise un upsert sur
  `id`. Une tentative refusée parce que déjà remise est retirée de la file sans boucle d'erreurs.
- **Diagnostic (`diagnostic.html`)** : vérifie le navigateur (`localStorage`, `fetch`, `crypto.randomUUID`),
  l'accès au service d'authentification, à la base et au catalogue d'Habitat-durable. Chaque contrôle s'affiche en
  vert ou en rouge, avec la conduite à tenir (« demander l'ouverture de `*.supabase.co` au filtrage du lycée »).
- **Limites de Supabase à régler (guide)** : la limite de connexions est de 30 par 5 minutes **par adresse IP**, or
  une classe entière sort par la même IP du lycée. Elle est à relever (par exemple à 300) dans Authentication > Rate
  Limits. Les inscriptions publiques sont à désactiver.
- **Mise en pause** : un projet gratuit est mis en pause après 7 jours de faible activité, ce qui arrive pendant les
  vacances. `maintien.yml` interroge la base tous les 3 jours (adresse et clé publique en *variables* Actions du
  dépôt). Restent à signaler dans le guide : GitHub désactive les tâches planifiées d'un dépôt public après 60 jours
  sans activité, et un projet en pause se relance depuis le tableau de bord.
- **Jamais** de clé `service_role`, de mot de passe ou de jeton dans un dépôt, un test ou un journal.

## 9. Tests

Ils tournent localement, sans réseau ni compte réel, grâce au backend de démonstration.

**Habitat-durable**
- Les tests existants passent inchangés (gabarit identique, 20/20 pour un sujet juste, 0/20 pour une copie d'examen
  vide, aucune erreur JavaScript).
- Anonyme : aucune requête réseau, aucun élément nouveau hormis le lien de connexion.
- Démonstration, entraînement : la tentative enregistrée porte la note affichée, les points et les réponses ; elle
  passe à `remise` quand tout est validé.
- Démonstration, examen : `en_cours` sans note pendant la composition, puis `remise` avec 20/20 pour un sujet juste ;
  modification refusée après la remise.
- File d'attente : réseau coupé, la tentative attend ; réseau rétabli, elle part, sans doublon.
- Catalogue : chaque item a une compétence connue ; ses `id` égalent ceux du moteur. Empreintes des deux modules.

**test-groupir**
- Unitaires (`node --test`) : identifiants (accents, apostrophes, doublons), mots de passe (alphabet, longueur),
  lecture des listes collées et des CSV (dont la forme Pronote), `calculerAcquisitions`, tentative qui compte,
  export CSV (guillemets, `;`, virgule décimale).
- Playwright (démonstration) : le prof crée une classe, importe 3 élèves et imprime les fiches ; un élève se
  connecte, passe par la page d'essai d'Habitat, revient et voit son résultat ; le prof voit la note, la copie, les
  compétences et l'analyse ; un élève ne voit rien d'un autre élève.
- `outils/verifier-rls.mjs`, lancé par toi sur le vrai projet avec des comptes de recette passés en variables
  d'environnement :
  - un élève ne lit ni les tentatives d'un autre ni une autre classe, et ne modifie pas une tentative remise ;
  - un élève ne s'inscrit pas seul ;
  - un second prof de recette ne voit pas tes classes.

## 10. Lots

Chaque lot se termine par une pull request par dépôt touché, des tests verts et un compte rendu : ce qui est fait,
ce qui est testé, ce qui reste à faire par toi, les écarts avec cette trame. Puis Claude Code s'arrête. Les pull
requests de test-groupir sont fusionnées par toi, car GitHub Pages publie `main`.

| Lot | Contenu | À faire par toi ensuite | État |
|---|---|---|---|
| 1. Fondations | `schema.sql`, fonction `gestion-eleves`, `module/suivi.js` (deux backends), `diagnostic.html`, workflows `static.yml` et `maintien.yml`, `docs/INSTALLATION.md`, tests unitaires, README | Créer le projet Supabase (Europe) et suivre `INSTALLATION.md` ; activer Pages (source : GitHub Actions) ; donner l'adresse du projet et la clé publique ; lancer le diagnostic sur un poste du lycée | à faire |
| 2. Portail et classes | Connexion, sessions, onglet Classes complet, fiches, « Mes cours » ; tests Playwright | Créer une classe de recette de 3 élèves fictifs, imprimer une fiche, se connecter avec | à faire |
| 3. Habitat-durable | Compétences, `catalogue.json`, `suivi-gabarit.js`, intégration dans `generer.py`, tests ; copie de recette dans `test-groupir/essai/habitat-durable/` (avec `depots.json` pointé dessus) | Faire un exercice d'entraînement et un examen en élève fictif sur la page d'essai | à faire |
| 4. Tableaux de bord | Onglets Notes, Compétences, Analyse, Fiche élève, copie détaillée, exports ; Mes résultats et Mes compétences ; tests | Vérifier les tableaux avec les données de recette | à faire |
| 5. Recette et mise en service | `verifier-rls.mjs`, `GUIDE-PROF.md`, `FICHE-TRAITEMENT.md`, `INFORMATION-FAMILLES.md`, notes de livraison ; `depots.json` repointé vers `../Habitat-durable/` | Lancer `verifier-rls.mjs` ; fusionner la PR d'Habitat-durable ; supprimer la classe de recette ; informer l'établissement | à faire |

Claude Code met à jour la colonne « État » à la fin de chaque lot.

## 11. Recette : la V1 est livrée quand

- [ ] Un élève non connecté utilise Habitat-durable exactement comme avant, hors ligne compris.
- [ ] Le diagnostic est vert sur un poste du lycée.
- [ ] Le prof crée une classe, importe une liste collée depuis un tableur et imprime les fiches.
- [ ] Un élève se connecte avec sa fiche et voit son nom sur la page d'exercice.
- [ ] Un exercice d'entraînement (1.2) et un examen (QCM 1.3) apparaissent chez le prof avec la note affichée chez
      l'élève, au point près.
- [ ] Pendant un examen, le prof voit « en cours » ; après la remise, la note et la copie, que l'élève ne peut plus
      modifier.
- [ ] Une tentative faite réseau coupé arrive au retour du réseau, sans doublon.
- [ ] Les tableaux Compétences et Analyse sont justes sur un cas vérifié à la main.
- [ ] Les exports CSV s'ouvrent correctement dans Excel.
- [ ] `verifier-rls.mjs` passe : aucune fuite entre élèves ni entre profs.
- [ ] Réinitialiser un mot de passe, retirer un élève et supprimer une classe fonctionnent.
- [ ] La documentation permet de tout réinstaller sans aide.

## 12. Hors V1 (pistes pour la V2)

- Brancher Chaîne fonctionnelle, Frottement et roulement…
- Reprise d'une tentative sur un autre poste.
- Quiz et jeux des cours.
- Travail donné avec date limite et mode imposé.
- Ajustement manuel des niveaux et commentaires du prof.
- Élève dans plusieurs groupes.
- Création de comptes prof depuis le portail.
- Export au format Pronote.
- Correction côté serveur pour les évaluations notées.
- Image des tracés.
- Référentiel officiel.

## 13. À confirmer par toi avant le lot 3

1. La liste des compétences du § 6, ou ton référentiel officiel (niveau et filière).
2. Les seuils 40 / 60 / 80 % et les libellés des niveaux.
3. Aucun nom de domaine personnalisé n'est prévu sur les dépôts.
4. test-groupir garde ce nom : un changement de nom change l'adresse du portail inscrite dans chaque dépôt.
