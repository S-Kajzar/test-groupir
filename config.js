/* Configuration du portail : adresse du projet Supabase et sa clé publique (« anon » ou « publishable »).
   Ces deux valeurs sont publiques par nature : la sécurité repose sur les règles d'accès de la base.
   La clé secrète (« service_role » ou « sb_secret_… ») ne va jamais ici, ni dans aucun fichier du dépôt.
   À renseigner après l'installation (docs/INSTALLATION.md, étape 8). Vides : seule la démonstration fonctionne. */
window.__SUIVI__ = {
  url: "",
  cle: "",
  portail: "./"
};
