# Installation du service : Supabase et GitHub

Ce guide se fait une fois, en 30 à 45 minutes, sans rien installer sur l'ordinateur. Il crée la base qui garde les
comptes et les résultats, puis publie le portail. Les libellés du tableau de bord de Supabase sont ceux d'octobre
2026 : s'ils ont un peu changé, cherche le terme le plus proche.

**Trois secrets ne quittent jamais tes mains** : le mot de passe de la base, la clé secrète (`service_role` ou
`sb_secret_…`) et le mot de passe de ton compte prof. Ils ne vont dans aucun fichier, aucun message, aucune
conversation, y compris avec Claude Code. Seules l'**adresse du projet** et sa **clé publique** se partagent : elles
sont publiques par nature.

## 1. Créer le projet Supabase

1. Va sur [supabase.com](https://supabase.com) et choisis **Start your project**. Connecte-toi avec ton compte GitHub.
2. Choisis **New project** :
   - *Organization* : ton organisation personnelle, offre **Free** ;
   - *Project name* : `suivi-eleves` ;
   - *Database password* : **Generate a password**, puis range-le dans ton gestionnaire de mots de passe. Il ne
     servira plus ;
   - *Region* : une région d'Europe, **Paris** (West EU) si elle est proposée, sinon **Frankfurt** (Central EU).
3. Valide par **Create new project**. La création prend environ deux minutes.

## 2. Relever l'adresse et la clé publique

Le bouton **Connect** en haut du projet, ou **Project Settings > API Keys**, affiche :

- l'**adresse du projet**, de la forme `https://abcd1234.supabase.co` ;
- la **clé publique** : la *publishable key* (`sb_publishable_…`). Si seul l'onglet *Legacy API keys* existe, prends
  la clé `anon` `public` (une longue chaîne qui commence par `eyJ`).

Ne copie pas la clé *secret* ni la clé `service_role`.

## 3. Régler l'authentification

1. **Authentication > Sign In / Providers** (parfois **Authentication > Settings**) : désactive **Allow new users to
   sign up**, puis enregistre. Personne ne pourra plus se créer un compte seul : les comptes élèves sont créés par le
   portail, ton compte prof par toi (étape 6). La connexion par adresse et mot de passe (*Email*) reste activée.
2. **Authentication > Rate Limits** : passe **sign-ups and sign-ins** à **300** (par 5 minutes), et **token
   refreshes** à **300** si le réglage est proposé, puis enregistre. Toute une classe sort par la même adresse IP du
   lycée, et la limite de départ (30 connexions en 5 minutes) bloquerait la fin de la classe.

## 4. Installer le schéma de la base

1. Ouvre [`supabase/schema.sql`](../supabase/schema.sql) sur GitHub et copie-le en entier (bouton **Copy raw file**).
2. Dans Supabase, ouvre **SQL Editor > New query**, colle, puis **Run**. Si Supabase prévient que la requête contient
   des opérations destructrices (elle remplace les règles d'accès), confirme : aucune donnée n'est effacée.
3. Le message attendu est *Success. No rows returned*.
4. Contrôle dans **Table Editor** : trois tables, `profils`, `classes` et `tentatives`, chacune marquée *RLS enabled*.

Le fichier peut être relancé à chaque mise à jour, sans perte de données.

## 5. Déployer la fonction `gestion-eleves`

1. **Edge Functions > Deploy a new function > Via Editor**.
2. Nom : `gestion-eleves`, exactement.
3. Remplace tout le code d'exemple par le contenu de
   [`supabase/functions/gestion-eleves/index.ts`](../supabase/functions/gestion-eleves/index.ts) (**Copy raw
   file**), puis **Deploy function**.
4. Dans la page de la fonction, onglet **Details** (ou **Settings**) : **désactive** la vérification JWT (*Verify JWT
   with legacy secret*, ou *Enforce JWT Verification*), puis enregistre. La fonction vérifie elle-même que l'appelant
   est un prof connecté. Laissée active, cette vérification de la passerelle peut bloquer les appels du navigateur.
5. Aucun secret à ajouter d'ordinaire : Supabase fournit lui-même l'adresse et la clé de service à la fonction. Si le
   diagnostic (étape 8) signale *clé de service absente* : **Edge Functions > Secrets > Add new secret**, nom
   `CLE_SECRETE`, valeur ta clé *secret* (`sb_secret_…`). C'est le seul endroit où elle va.

## 6. Créer ton compte prof

1. **Authentication > Users > Add user > Create new user** : ton adresse mail, un mot de passe de 12 caractères au
   moins (gestionnaire de mots de passe), **Auto Confirm User** coché, puis **Create user**.
2. **SQL Editor > New query** : colle la requête ci-dessous, remplace ton prénom, ton nom et l'adresse du compte,
   puis **Run**.

   ```sql
   insert into public.profils (id, role, prenom, nom, identifiant)
   select id, 'prof', 'Prénom', 'Nom', lower(email) from auth.users where email = 'ton.adresse@exemple.fr';
   ```

3. Contrôle : `select prenom, nom, role from public.profils;` doit afficher ta ligne avec le rôle `prof`.

**Domaine des comptes élèves** (une minute, à faire maintenant) : les élèves se connectent avec un identifiant sans
mail, rangé dans Supabase sous l'adresse fictive `identifiant@eleves.invalid`. Vérifie que Supabase l'accepte :
**Add user > Create new user**, adresse `essai.domaine@eleves.invalid`, n'importe quel mot de passe, **Auto Confirm
User** coché.
- Si le compte est créé, supprime-le (menu **⋯ > Delete user**) : tout va bien.
- S'il est refusé, note le message et donne-le à la session du lot 2.

## 7. Régler le dépôt GitHub `test-groupir`

1. **Settings > Pages > Build and deployment > Source** : **GitHub Actions**. Le portail est publié depuis la branche
   `main` à l'adresse `https://s-kajzar.github.io/test-groupir/`.
2. **Settings > Secrets and variables > Actions**, onglet **Variables**, **New repository variable**, deux fois :
   - `SUPABASE_URL` : l'adresse du projet ;
   - `SUPABASE_CLE_PUBLIQUE` : la clé publique.
3. **Actions > Maintien du projet Supabase > Run workflow** : la tâche doit finir en vert, avec *Réponse de la base :
   "ok"*. Elle tourne ensuite seule, chaque jour.

## 8. Vérifier

1. Ouvre `https://s-kajzar.github.io/test-groupir/diagnostic.html`. Colle l'adresse et la clé publique, puis **Lancer
   le diagnostic** : tout doit être vert, sauf *Cours Habitat-durable* en « Info » jusqu'au lot 3.
2. **Essai de connexion** : ton adresse et ton mot de passe de prof. Le message attendu est *Connexion réussie :
   Prénom Nom (professeur)*.
3. Au lycée, sur un poste fixe puis sur une tablette, relance le diagnostic. Si *Service de connexion* est rouge,
   **Copier le rapport** et envoie-le au responsable informatique : il faut autoriser `*.supabase.co`.

## 9. Passer au lot 2

Donne à la session Claude Code du lot 2 **l'adresse du projet et la clé publique**, et rien d'autre. Par exemple :
« Adresse : https://abcd1234.supabase.co — clé publique : sb_publishable_… ». Elle les inscrira dans `config.js`,
qui préremplira le diagnostic et servira au portail.

## À savoir ensuite

- **Mise en pause** : un projet gratuit inactif 7 jours est mis en pause ; la tâche de maintien l'évite. S'il l'est
  malgré tout, Supabase prévient par mail : **Restore project** dans le tableau de bord le relance, données comprises.
- **Tâche de maintien suspendue** : GitHub suspend les tâches planifiées d'un dépôt public resté 60 jours sans
  activité, et prévient par mail. Réactive-la dans **Actions**.
- **Clé secrète divulguée par erreur** : **Project Settings > API Keys**, régénère-la. Si tu avais créé le secret
  `CLE_SECRETE`, mets-le à jour.
- **Limites de l'offre gratuite** : largement suffisantes pour quelques classes. Le détail est sur
  [supabase.com/pricing](https://supabase.com/pricing).

## Dépannage

| Symptôme | Cause probable | Que faire |
|---|---|---|
| Diagnostic : *Service de connexion* rouge, « requête bloquée » | filtrage du réseau | faire autoriser `*.supabase.co` (HTTPS, port 443) |
| Diagnostic : *Clé publique refusée* | clé mal copiée | recopier la clé publique (étape 2) |
| Diagnostic : *Base de données*, « fonction ping absente » | schéma non installé | étape 4 |
| Diagnostic : *Fonction gestion-eleves*, « fonction absente » | fonction non déployée, ou mal nommée | étape 5, nom exact `gestion-eleves` |
| Diagnostic : *Fonction*, « la passerelle de Supabase refuse l'appel » | vérification JWT active | étape 5, point 4 |
| Essai de connexion : « Ce compte n'a pas de profil » | requête SQL de l'étape 6 non faite, ou adresse différente | étape 6, point 2 |
| Essai de connexion : « Compte non confirmé » | *Auto Confirm User* non coché | supprimer le compte et le recréer (étape 6) |
| Essai de connexion : « Trop de connexions » | limite de l'étape 3 non relevée | étape 3, point 2 |
