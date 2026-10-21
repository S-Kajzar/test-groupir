# Prompt à donner à Claude Code

Ouvre une session Claude Code avec les dépôts **S-Kajzar/test-groupir** et **S-Kajzar/Habitat-durable**, puis colle
le texte ci-dessous. Change seulement le numéro du lot à chaque nouvelle session (1, puis 2… jusqu'à 5).

---

```text
Lot à réaliser : 1

Contexte
Mes dépôts de cours (pages HTML statiques générées, publiées par GitHub Pages) fonctionnent. Je veux y ajouter des
comptes élèves et prof pour enregistrer les résultats des exercices et suivre les notes et les compétences de mes
classes. Le projet est décrit en entier dans TRAME-PROJET.md (dépôt test-groupir) : c'est le cahier des charges et
il fait foi.

Avant d'écrire du code
1. Lis TRAME-PROJET.md en entier.
2. Lis README.md et NOTE-DE-LIVRAISON.md de Habitat-durable, puis src/generer.py et le moteur du gabarit
   (src/gabarit-exercice-interactif.html, en particulier window.__app__, startMode, updateScore, gradeAll).
3. Lis la ligne du lot demandé dans le § 10 de la trame, et la colonne « État » des lots précédents.

Règles
- Réalise le lot demandé, et seulement lui. Ne commence pas le lot suivant.
- Ce qui n'est pas dans la trame n'est pas à faire. S'il manque une décision, ou si la trame contredit le code,
  arrête-toi et pose-moi la question au lieu de trancher seul.
- Ne modifie jamais src/gabarit-exercice-interactif.html : son empreinte SHA-256 est vérifiée par les tests.
- Pas de dépendance externe dans les pages (pas de CDN, pas de supabase-js, pas de framework, pas d'étape de
  construction) : HTML, CSS et JavaScript simples, dans le style et la charte des dépôts de cours.
- Textes, commentaires, noms de fichiers et identifiants en français, comme dans les dépôts existants.
- N'écris jamais de clé service_role, de mot de passe ou de jeton dans un fichier, un commit, un test ou un journal.
  Seules l'adresse du projet Supabase et sa clé publique peuvent figurer dans les dépôts.
- Les tests passent par le backend de démonstration et tournent sans réseau. Les tests existants de
  Habitat-durable doivent rester verts, sans modification de leurs attentes.
- Avant chaque commit : lance tous les tests des dépôts touchés, puis relis ton diff.

Fin du lot
1. Mets à jour la colonne « État » du § 10 de TRAME-PROJET.md, ainsi que README.md et NOTE-DE-LIVRAISON.md.
2. Pousse sur ta branche de travail et ouvre une pull request par dépôt touché.
3. Donne-moi un compte rendu court :
   - ce qui est fait ;
   - ce qui est testé, avec le résultat des tests ;
   - ce que je dois faire moi-même, pas à pas ;
   - les écarts avec la trame et les points à vérifier.
4. Arrête-toi là.
```

---

## Entre deux lots

- Après le lot 1 : suis `docs/INSTALLATION.md`, puis donne à la session suivante l'adresse du projet et la clé
  publique, par exemple : « Adresse : https://xxxx.supabase.co — clé publique : sb_publishable_… ».
- Avant le lot 3 : réponds aux questions du § 13 de la trame (compétences, seuils), ou laisse les valeurs
  provisoires.
- Fusionne la pull request de test-groupir à la fin de chaque lot, pour que GitHub Pages publie le portail.
