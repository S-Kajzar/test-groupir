# Note de livraison — Suivi des élèves

## Lot 1 : fondations

**Livré** : schéma de la base (`supabase/schema.sql`), fonction `gestion-eleves`, module commun `module/suivi.js`
(backends Supabase et démonstration), page de diagnostic, charte du portail, configuration, publication GitHub Pages,
tâche de maintien, guide d'installation, tests. Aucun dépôt de cours n'est touché à ce lot.

**Tests** : 49, tous verts, sans réseau ni compte réel.

| Fichier | Tests | Ce qui est vérifié |
|---|---|---|
| `schema.test.js` | 11 | règles d'accès vues par chaque rôle dans un vrai Postgres (PGlite) : sans compte, élève, prof, autre prof ; tentative remise figée (409), champs d'identité figés (400) ; contraintes ; cascades ; schéma ré-exécutable |
| `fonction.test.js` | 11 | identifiants (accents, apostrophes, doublons, 30 caractères), mots de passe ; appelant prof obligatoire ; les quatre actions ; compte orphelin ; refus du service rapporté sans compte orphelin ; CORS ; clé de service ancienne ou nouvelle |
| `suivi.test.js` | 18 | configuration, démonstration ; session de 2 h (élève) et 12 h (prof) ; jeton rafraîchi ; règles d'accès de la démonstration ; file d'attente : hors ligne, poste partagé, modification pendant un envoi, erreur passagère ou définitive, envoi d'urgence ; en-têtes envoyés à Supabase ; même identifiant et même mot de passe que la fonction |
| `diagnostic.test.js` | 9 | Chromium : poste prêt, réseau bloqué, clé secrète refusée sans aucun appel, schéma ou fonction absents, passerelle JWT active, essai de connexion, démonstration, téléphone de 375 px |

### Décisions de réalisation

- **Fonction en un seul fichier, sans import.** Elle se colle dans l'éditeur du tableau de bord de Supabase, sans
  outil en ligne de commande. Elle parle à Supabase par `fetch`. Les tests l'importent en retirant ses types
  (`stripTypeScriptTypes` de Node).
- **Vérification JWT de la passerelle désactivée** pour la fonction (guide, étape 5). La fonction vérifie elle-même
  le jeton auprès de `/auth/v1/user`, puis le rôle prof dans `profils`. Elle évite ainsi les refus de la passerelle
  sur les requêtes préalables du navigateur et sur les nouvelles clés de signature.
- **Clé de service** : la fonction lit `SUPABASE_SERVICE_ROLE_KEY`, fourni par Supabase, ou à défaut le secret
  `CLE_SECRETE`. Une ancienne clé (jeton `eyJ…`) va aussi dans `Authorization`, une clé `sb_secret_…` seulement dans
  `apikey`. Le module fait de même avec la clé publique.
- **`ping()`** : fonction SQL ajoutée au schéma, appelable sans compte. Elle sert au diagnostic et au maintien, sans
  rien ouvrir des tables, qui restent fermées aux visiteurs sans compte.
- **Codes d'erreur `PT409` et `PT400`** dans le déclencheur : l'API répond 409 (« déjà remise ») ou 400 (« champ non
  modifiable »). Le module retire alors la tentative de la file et note le refus (`Suivi.rejets()`), sans boucle
  d'erreurs.
- **Classe d'un élève** : `profils.classe_id` est en `on delete restrict` et une contrainte impose une classe à
  chaque élève, et aucune à un prof. Une classe ne se supprime donc qu'après ses élèves, ce que fait la fonction.
  Aucun compte orphelin n'est possible.
- **Droits de modification restreints aux colonnes** : un prof ne modifie que `nom` et `annee` d'une classe.
- **Identifiant et mot de passe** fabriqués à l'identique dans la fonction et dans le module (pour la
  démonstration) ; un test compare les deux sur un corpus de noms.
- **File d'attente par élève** : une tentative n'est envoyée qu'avec la session de son auteur. Sur un poste partagé,
  elle attend sa prochaine connexion au lieu d'être refusée ou envoyée sous un autre nom. Elle est oubliée au bout de
  30 jours.
- **Démonstration** : mêmes adresses et mêmes réponses que Supabase. Elle reproduit les règles d'accès et le
  déclencheur du schéma, ainsi que la fonction. Comptes `prof.demo` (classe « 2A démo »), `lucas.martin` et
  `zoe.durand`, mot de passe `demo`.
- **Style** : JavaScript sans dépendance, `var` et `function` comme dans le gabarit des cours ; Playwright fixé à la
  version 1.56.1 (celle des autres dépôts).

### Écarts avec la trame (trame mise à jour)

- **`creer_eleves`** répond `{ eleves, erreurs }` au lieu d'une simple liste. Si une ligne échoue, les autres comptes
  sont tout de même créés, et la ligne fautive est signalée.
- **Maintien quotidien** au lieu de tous les 3 jours. La documentation de Supabase parle de « quelques requêtes à la
  base chaque jour » pour éviter la pause.
- **Fichiers créés dès ce lot** : `config.js` et `portail.css` (nécessaires au diagnostic), et une page d'attente
  `index.html`, pour que l'adresse du portail ne renvoie pas d'erreur avant le lot 2.

### À faire par toi

Suivre [`docs/INSTALLATION.md`](docs/INSTALLATION.md) :

1. Projet Supabase en Europe, réglages de l'authentification.
2. Schéma et fonction installés ; ton compte prof.
3. Essai du domaine `eleves.invalid`.
4. GitHub Pages et variables du maintien.
5. Diagnostic au lycée.

Puis fusionner la pull request, et donner l'adresse et la clé publique à la session du lot 2.

### Points à vérifier

- **Domaine `eleves.invalid`** : il n'a pas pu être essayé sur un vrai projet. Le guide le fait vérifier à la main
  (étape 6) avant le lot 2.
- **Libellés du tableau de bord de Supabase** (réglages de la vérification JWT, limites de connexion) : décrits sans
  avoir été vus sur un vrai projet ; ils peuvent différer un peu. Le diagnostic signale tout réglage oublié.
