// Garde-fou de déploiement (« Ignored Build Step » de Vercel, voir vercel.json > ignoreCommand).
// Si les fichiers envoyés sont incohérents (envoi partiel : fichier manquant, import introuvable, erreur de syntaxe,
// trop de fonctions), le déploiement est ANNULÉ et la version actuellement en ligne reste en place,
// au lieu de mettre en ligne un site qui répond « erreur 500 ».
//
// Code de sortie : 0 = annuler ce déploiement (incohérence détectée) ; 1 = déployer normalement.
// Toute erreur inattendue de ce script => déploiement normal (jamais de blocage par erreur).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(process.argv[2] || ".");
const problems = [];

try {
  const apiDir = path.join(root, "api");
  const files = fs.existsSync(apiDir) ? fs.readdirSync(apiDir).filter((f) => f.endsWith(".js")) : [];
  const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(apiDir, f), "utf8")]));

  // 1) syntaxe de tous les fichiers JavaScript du site
  const jsDir = path.join(root, "js");
  const toCheck = [...files.map((f) => path.join(apiDir, f)), ...(fs.existsSync(jsDir) ? fs.readdirSync(jsDir).filter((f) => f.endsWith(".js")).map((f) => path.join(jsDir, f)) : [])];
  for (const f of toCheck) {
    const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
    if (r.status !== 0) problems.push(`Erreur de syntaxe dans ${path.relative(root, f)} : ${String(r.stderr || "").split("\n").find((l) => /Error/.test(l)) || "fichier invalide"}`);
  }

  // 2) chaque import nommé de api/*.js doit exister dans le fichier importé
  const exportsOf = (s) => {
    const names = new Set([...s.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]));
    for (const m of s.matchAll(/export\s*\{([^}]+)\}/g)) m[1].split(",").forEach((x) => names.add(x.trim().split(/\s+as\s+/).pop()));
    if (/export\s+default/.test(s)) names.add("default");
    return names;
  };
  const exp = Object.fromEntries(Object.entries(src).map(([f, s]) => [f, exportsOf(s)]));
  for (const [f, s] of Object.entries(src)) {
    for (const m of s.matchAll(/import\s*(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["'](\.\/[^"']+)["']/g)) {
      const target = path.basename(m[3]);
      if (!(target in src)) { problems.push(`api/${f} importe ${target}, fichier absent du dépôt`); continue; }
      for (const w of (m[2] || "").split(",").map((x) => x.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)) {
        if (!exp[target].has(w)) problems.push(`api/${f} importe « ${w} » qui n'existe pas dans api/${target} (version différente de ce fichier ?)`);
      }
    }
  }

  // 3) plan gratuit Vercel : 12 fonctions maximum (les fichiers commençant par « _ » ne comptent pas)
  const fns = files.filter((f) => !f.startsWith("_"));
  if (fns.length > 12) problems.push(`${fns.length} fonctions dans api/ (maximum 12 sur le plan gratuit) : ${fns.join(", ")}`);

  // 4) vercel.json valide
  const vj = path.join(root, "vercel.json");
  if (fs.existsSync(vj)) { try { JSON.parse(fs.readFileSync(vj, "utf8")); } catch (e) { problems.push("vercel.json invalide : " + e.message); } }
} catch (e) {
  console.log("[check-deploy] contrôle impossible (" + e.message + ") : déploiement normal.");
  process.exit(1);
}

if (problems.length) {
  console.log("[check-deploy] DÉPLOIEMENT ANNULÉ : fichiers incohérents. La version actuelle reste en ligne.");
  problems.forEach((p) => console.log("  ✗ " + p));
  console.log("  → Renvoyez tous les fichiers du zip en un seul commit (voir README).");
  process.exit(0);
}
console.log("[check-deploy] fichiers cohérents : déploiement.");
process.exit(1);
