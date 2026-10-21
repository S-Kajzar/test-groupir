// Schéma de la base (supabase/schema.sql) dans un vrai Postgres (PGlite) : règles d'accès vues par chaque rôle.
// Le strict nécessaire de Supabase est simulé : schéma auth, auth.uid() lu dans le jeton, rôles anon et authenticated.
// Usage : node --test tests/schema.test.js   (après npm install)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA = fs.readFileSync(path.join(__dirname, "..", "supabase", "schema.sql"), "utf8");

const SUPABASE_SIMULE = `
create schema auth;
create table auth.users (id uuid primary key, email text unique);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon nologin;
create role authenticated nologin;
grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
`;

const ID = {
  profA: "00000000-0000-4000-8000-00000000000a", profB: "00000000-0000-4000-8000-00000000000b",
  a1: "00000000-0000-4000-8000-0000000000a1", a2: "00000000-0000-4000-8000-0000000000a2",
  b1: "00000000-0000-4000-8000-0000000000b1",
  classeA: "00000000-0000-4000-8000-00000000c1a0", classeB: "00000000-0000-4000-8000-00000000c1b0",
};
let n = 0;
const nouvelId = () => "00000000-0000-4000-9000-" + String(++n).padStart(12, "0");

let db;

// exécute fn sous l'identité uid (null : sans compte), puis revient au superutilisateur
async function en(uid, fn) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return await fn(); } finally { await db.exec("reset role"); }
}

async function refus(promesse, code) {
  await assert.rejects(promesse, (e) => { assert.equal(e.code, code, e.message); return true; });
}

function tentative(eleve, classe, champs) {
  return Object.assign({ id: nouvelId(), eleve_id: eleve, classe_id: classe, depot: "habitat-durable",
    activite: "isoler-paroi", mode: "entrainement", statut: "en_cours", debut: "2026-10-21T08:00:00.000Z" }, champs);
}

async function inserer(t) {
  const cols = Object.keys(t);
  const r = await db.query(`insert into public.tentatives (${cols.join(", ")}) values (${cols.map((_, i) => "$" + (i + 1)).join(", ")})`,
    cols.map((c) => (c === "detail" ? JSON.stringify(t[c]) : t[c])));
  return r.affectedRows;
}

test.before(async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  db = new PGlite();
  await db.exec(SUPABASE_SIMULE);
  await db.exec(SCHEMA);
  await db.exec(SCHEMA); // ré-exécutable
  for (const k of ["profA", "profB", "a1", "a2", "b1"]) await db.query("insert into auth.users (id) values ($1)", [ID[k]]);
  await db.query(`insert into public.profils (id, role, prenom, nom, identifiant) values
    ($1, 'prof', 'Anne', 'Prof', 'anne.prof@exemple.fr'), ($2, 'prof', 'Bruno', 'Prof', 'bruno.prof@exemple.fr')`,
    [ID.profA, ID.profB]);
  await db.query(`insert into public.classes (id, prof_id, nom, annee) values
    ($1, $2, '2A', '2026-2027'), ($3, $4, '2B', '2026-2027')`, [ID.classeA, ID.profA, ID.classeB, ID.profB]);
  await db.query(`insert into public.profils (id, role, prenom, nom, identifiant, classe_id) values
    ($1, 'eleve', 'Lucas', 'Martin', 'lucas.martin', $4), ($2, 'eleve', 'Zoé', 'Durand', 'zoe.durand', $4),
    ($3, 'eleve', 'Inès', 'Bernard', 'ines.bernard', $5)`, [ID.a1, ID.a2, ID.b1, ID.classeA, ID.classeB]);
});

test("sans compte : aucune table lisible, seul ping répond", async () => {
  await en(null, async () => {
    for (const t of ["profils", "classes", "tentatives"]) await refus(db.query(`select * from public.${t}`), "42501");
    assert.equal((await db.query("select public.ping() as r")).rows[0].r, "ok");
    await refus(db.query("select public.est_prof()"), "42501");
  });
});

test("un élève lit son profil et sa classe, rien d'autre", async () => {
  await en(ID.a1, async () => {
    assert.deepEqual((await db.query("select identifiant from public.profils")).rows, [{ identifiant: "lucas.martin" }]);
    assert.deepEqual((await db.query("select nom from public.classes")).rows, [{ nom: "2A" }]);
    await refus(db.query("insert into public.profils (id, role, prenom, nom, identifiant, classe_id) values ($1, 'eleve', 'X', 'Y', 'x.y', $2)",
      [nouvelId(), ID.classeA]), "42501");
    await refus(db.query("insert into public.classes (nom, annee) values ('Pirate', '2026-2027')"), "42501");
  });
});

test("un élève crée ses tentatives, pour lui et sa classe seulement", async () => {
  await en(ID.a1, async () => {
    assert.equal(await inserer(tentative(ID.a1, ID.classeA, { detail: { items: [] } })), 1);
    await refus(inserer(tentative(ID.a2, ID.classeA)), "42501");  // au nom d'un autre
    await refus(inserer(tentative(ID.a1, ID.classeB)), "42501");  // dans une autre classe
  });
  await en(ID.profA, async () => { await refus(inserer(tentative(ID.profA, ID.classeA)), "42501"); });
});

test("les tentatives d'un élève ne sont lues que par lui et par le prof de sa classe", async () => {
  const t = tentative(ID.a1, ID.classeA, { note20: 12.5 });
  await en(ID.a1, () => inserer(t));
  const lire = () => db.query("select id from public.tentatives where id = $1", [t.id]);
  await en(ID.a1, async () => assert.equal((await lire()).rows.length, 1));
  await en(ID.a2, async () => assert.equal((await lire()).rows.length, 0));
  await en(ID.b1, async () => assert.equal((await lire()).rows.length, 0));
  await en(ID.profA, async () => assert.equal((await lire()).rows.length, 1));
  await en(ID.profB, async () => assert.equal((await lire()).rows.length, 0));
});

test("un prof lit les élèves de ses classes, pas ceux d'un autre prof", async () => {
  await en(ID.profA, async () => {
    const ids = (await db.query("select identifiant from public.profils order by identifiant")).rows.map((r) => r.identifiant);
    assert.deepEqual(ids, ["anne.prof@exemple.fr", "lucas.martin", "zoe.durand"]);
    assert.deepEqual((await db.query("select nom from public.classes")).rows, [{ nom: "2A" }]);
  });
});

test("une tentative en cours se met à jour ; remise, elle ne change plus", async () => {
  const t = tentative(ID.a1, ID.classeA);
  await en(ID.a1, async () => {
    await inserer(t);
    const maj = await db.query("update public.tentatives set note20_provisoire = 14, items_valides = 3 where id = $1", [t.id]);
    assert.equal(maj.affectedRows, 1);
    await db.query("update public.tentatives set statut = 'remise', note20 = 15, fin = now() where id = $1", [t.id]);
    await refus(db.query("update public.tentatives set note20 = 20 where id = $1", [t.id]), "PT409");
    // envoi répété (upsert) d'une tentative remise : refusé de même
    await refus(db.query(`insert into public.tentatives (id, eleve_id, classe_id, depot, activite, mode, debut, note20)
      values ($1, $2, $3, 'habitat-durable', 'isoler-paroi', 'entrainement', $4, 20)
      on conflict (id) do update set note20 = excluded.note20`, [t.id, ID.a1, ID.classeA, t.debut]), "PT409");
    assert.equal(Number((await db.query("select note20 from public.tentatives where id = $1", [t.id])).rows[0].note20), 15);
  });
});

test("les champs d'identité d'une tentative ne se modifient pas", async () => {
  const t = tentative(ID.a1, ID.classeA);
  await en(ID.a1, async () => {
    await inserer(t);
    await refus(db.query("update public.tentatives set activite = 'iti-ite' where id = $1", [t.id]), "PT400");
    await refus(db.query("update public.tentatives set mode = 'examen' where id = $1", [t.id]), "PT400");
    await refus(db.query("update public.tentatives set debut = now() where id = $1", [t.id]), "PT400");
  });
});

test("un prof n'écrit ni ne supprime de tentative ; personne ne supprime directement", async () => {
  const t = tentative(ID.a1, ID.classeA, { note20: 8 });
  await en(ID.a1, () => inserer(t));
  await en(ID.profA, async () => {
    assert.equal((await db.query("update public.tentatives set note20 = 20 where id = $1", [t.id])).affectedRows, 0);
    await refus(db.query("delete from public.tentatives where id = $1", [t.id]), "42501");
    await refus(db.query("delete from public.classes where id = $1", [ID.classeA]), "42501");
  });
  await en(ID.a1, async () => { await refus(db.query("delete from public.tentatives where id = $1", [t.id]), "42501"); });
});

test("un prof crée et renomme ses classes, pas celles d'un autre", async () => {
  await en(ID.profA, async () => {
    const r = await db.query("insert into public.classes (nom, annee) values ('1STI2D-G1', '2026-2027') returning prof_id");
    assert.equal(r.rows[0].prof_id, ID.profA);
    await refus(db.query("insert into public.classes (prof_id, nom, annee) values ($1, 'Intrus', '2026-2027')", [ID.profB]), "42501");
    assert.equal((await db.query("update public.classes set nom = '2A bis' where id = $1", [ID.classeA])).affectedRows, 1);
    assert.equal((await db.query("update public.classes set nom = 'Volée' where id = $1", [ID.classeB])).affectedRows, 0);
    await refus(db.query("update public.classes set prof_id = $1 where id = $2", [ID.profB, ID.classeA]), "42501");
    await db.query("update public.classes set nom = '2A' where id = $1", [ID.classeA]);
  });
});

test("contrôles de la base : taille du détail, valeurs permises, rôle et classe", async () => {
  await en(ID.a1, async () => {
    await refus(inserer(tentative(ID.a1, ID.classeA, { detail: { gros: "x".repeat(300000) } })), "23514");
    await refus(inserer(tentative(ID.a1, ID.classeA, { mode: "libre" })), "23514");
    await refus(inserer(tentative(ID.a1, ID.classeA, { note20: 21 })), "23514");
  });
  await refus(db.query("insert into public.profils (id, role, prenom, nom, identifiant) values ($1, 'eleve', 'Sans', 'Classe', 'sans.classe')",
    [ID.b1]), "23514");
});

test("supprimer un compte efface son profil et ses tentatives ; une classe habitée ne se supprime pas", async () => {
  const uid = nouvelId();
  await db.query("insert into auth.users (id) values ($1)", [uid]);
  await db.query("insert into public.profils (id, role, prenom, nom, identifiant, classe_id) values ($1, 'eleve', 'Tom', 'Petit', 'tom.petit', $2)",
    [uid, ID.classeB]);
  await en(uid, () => inserer(tentative(uid, ID.classeB)));
  await refus(db.query("delete from public.classes where id = $1", [ID.classeB]), "23001");
  await db.query("delete from auth.users where id = $1", [uid]);
  assert.equal((await db.query("select count(*)::int as n from public.profils where id = $1", [uid])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int as n from public.tentatives where eleve_id = $1", [uid])).rows[0].n, 0);
});
