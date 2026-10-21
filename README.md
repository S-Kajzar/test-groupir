# Suivi des élèves : portail, comptes et résultats

Portail des cours interactifs (dépôts publiés par GitHub Pages, comme « Habitat durable ») : comptes élèves et
professeurs, enregistrement des exercices, suivi des notes et des compétences de la classe. Sans compte, les pages de
cours restent utilisables comme aujourd'hui ; la connexion sert à enregistrer les résultats.

Le cahier des charges est [`TRAME-PROJET.md`](TRAME-PROJET.md) : il fait foi. Le prompt de chaque étape est dans
[`PROMPT-CLAUDE-CODE.md`](PROMPT-CLAUDE-CODE.md). Les décisions et les écarts de chaque lot sont dans
[`NOTE-DE-LIVRAISON.md`](NOTE-DE-LIVRAISON.md).

**État : lot 1 (fondations).** La base, la fonction de gestion des comptes, le module commun et la page de diagnostic
sont prêts. La connexion au portail ouvre au lot 2 ; d'ici là, `index.html` est une page d'attente.

| Adresse | Contenu |
|---|---|
| `https://s-kajzar.github.io/test-groupir/` | page d'attente du portail (connexion au lot 2) |
| `…/diagnostic.html` | diagnostic d'un poste et du réseau de l'établissement, essai de connexion |
| `…/diagnostic.html?suivi=demo` | même page en démonstration (comptes `prof.demo`, `lucas.martin`, `zoe.durand`, mot de passe `demo`) ; `?suivi=reel` pour revenir |

## Installer le service

Une fois, sans rien installer sur l'ordinateur : [`docs/INSTALLATION.md`](docs/INSTALLATION.md). On y crée le projet
Supabase (région Europe), on installe le schéma, on déploie la fonction `gestion-eleves`, on crée son compte prof, on
active GitHub Pages et la tâche de maintien, puis on vérifie avec le diagnostic.

## Tester

Node 22.13 ou plus récent.

```sh
npm install                          # PGlite (Postgres pour les tests du schéma) et Playwright 1.56.1
npx playwright install chromium      # une fois, si Chromium n'est pas déjà installé pour Playwright
node --test tests/*.test.js          # tous les tests
node --test tests/schema.test.js     # schéma : règles d'accès vues par chaque rôle, dans un vrai Postgres (PGlite)
node --test tests/fonction.test.js   # fonction gestion-eleves contre un faux Supabase
node --test tests/suivi.test.js      # module commun : session, file d'attente, démonstration, Supabase simulé
node --test tests/diagnostic.test.js # page de diagnostic dans Chromium, Supabase simulé
```

Aucun test n'a besoin du réseau ni d'un compte Supabase.

## Organisation

| Chemin | Rôle |
|---|---|
| `supabase/schema.sql` | tables `profils`, `classes`, `tentatives`, règles d'accès (RLS), déclencheur, `ping()` ; à coller dans SQL Editor, ré-exécutable |
| `supabase/functions/gestion-eleves/index.ts` | fonction Supabase, seule détentrice de la clé de service : créer des élèves, réinitialiser un mot de passe, supprimer un élève ou une classe ; un seul fichier sans import |
| `module/suivi.js` | **source de référence** du module commun, recopié à l'identique dans les dépôts de cours : session, accès à Supabase par `fetch`, file d'attente des tentatives, backend de démonstration |
| `config.js` | adresse du projet et clé publique (vides tant que l'installation n'est pas faite) |
| `portail.css` | charte des dépôts de cours (variables et polices du gabarit) |
| `index.html`, `diagnostic.html` | page d'attente ; diagnostic |
| `docs/INSTALLATION.md` | installation pas à pas |
| `tests/` | tests Node, PGlite et Playwright ; `tests/outils.js` charge la fonction et le module dans des bacs à sable |
| `.github/workflows/static.yml` | publication GitHub Pages (branche `main`), copiée d'Habitat-durable |
| `.github/workflows/maintien.yml` | appel quotidien de la base, pour qu'un projet gratuit ne soit pas mis en pause |

## Module commun

`module/suivi.js` expose `window.Suivi` :

- **session** : `connecter`, `deconnecter`, `utilisateur`, `finDeSession` ;
- **données** : `lire`, `inserer`, `modifier`, `fonction` ;
- **tentatives** : `enregistrerTentative`, `vider`, `etat`, `rejets` ;
- **démonstration** : `demo.activer`, `demo.reinitialiser`, `demo.horsLigne`.

Il émet `suivi:session` et `suivi:etat` sur `window`. Une modification se fait **ici**, avec un nouveau numéro de
version, puis la copie est remplacée dans chaque dépôt de cours ; leurs tests vérifient l'empreinte de la copie.
