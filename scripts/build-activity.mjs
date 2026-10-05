// Builds data/activity.json for the portfolio.
// Publishes daily contribution counts and project summaries you approve in activity.config.json.
// Private repository names, URLs, code and commit messages are never written or logged.
//
//   node scripts/build-activity.mjs            build data/activity.json
//   node scripts/build-activity.mjs --hashes   (run locally only) print repo hashes to paste into the config
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const env = process.env;
const cfg = JSON.parse(await readFile(new URL("../activity.config.json", import.meta.url), "utf8"));
const DAY = 864e5, WEEKS = 12;
const to = new Date();
const yearFrom = new Date(to.getTime() - 364 * DAY);
const recentFrom = new Date(to.getTime() - WEEKS * 7 * DAY);
const hash = s => createHash("sha256").update(s.toLowerCase()).digest("hex").slice(0, 16);

const QUERY = `query($login: String!, $yf: DateTime!, $rf: DateTime!, $to: DateTime!) {
  user(login: $login) {
    year: contributionsCollection(from: $yf, to: $to) {
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    }
    recent: contributionsCollection(from: $rf, to: $to) {
      commitContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner isPrivate url }
        contributions(first: 100) { nodes { occurredAt commitCount } }
      }
    }
  }
}`;

async function gql(token, variables) {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "portfolio-activity" },
    body: JSON.stringify({ query: QUERY, variables })
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error("GitHub API request failed with status " + r.status + ". Check the token scopes.");
  return j.data.user;
}

const accounts = [
  { key: "p", login: env.PERSONAL_LOGIN, token: env.GH_PERSONAL_TOKEN || env.GITHUB_TOKEN },
  { key: "w", login: env.WORK_LOGIN, token: env.GH_WORK_TOKEN }
].filter(a => a.login && a.token);
if (!accounts.length) throw new Error("Set PERSONAL_LOGIN / WORK_LOGIN and their tokens.");

const days = new Map();
const repos = [];
const weekIndex = iso => Math.min(WEEKS - 1, Math.max(0, WEEKS - 1 - Math.floor((to - new Date(iso)) / (7 * DAY))));

for (const a of accounts) {
  const u = await gql(a.token, { login: a.login, yf: yearFrom.toISOString(), rf: recentFrom.toISOString(), to: to.toISOString() });
  for (const wk of u.year.contributionCalendar.weeks) {
    for (const d of wk.contributionDays) {
      const e = days.get(d.date) || { d: d.date, p: 0, w: 0 };
      e[a.key] += d.contributionCount;
      days.set(d.date, e);
    }
  }
  for (const c of u.recent.commitContributionsByRepository) {
    const weekly = Array(WEEKS).fill(0);
    let last = null;
    for (const n of c.contributions.nodes) {
      weekly[weekIndex(n.occurredAt)] += n.commitCount;
      if (!last || n.occurredAt > last) last = n.occurredAt;
    }
    repos.push({ account: a.key, name: c.repository.nameWithOwner, id: hash(c.repository.nameWithOwner),
      isPrivate: c.repository.isPrivate, url: c.repository.url, weekly, last });
  }
}

if (process.argv.includes("--hashes")) {
  if (env.CI) throw new Error("--hashes prints repository names. Run it on your own machine, not in CI.");
  console.table(repos.map(r => ({ repo: r.name, private: r.isPrivate, hash: "sha256:" + r.id })));
  process.exit(0);
}

const weekStart = iso => {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const used = new Set();
const projects = [];

for (const p of cfg.projects) {
  const ids = (p.repos || []).map(s => s.replace(/^sha256:/, ""));
  const hit = repos.filter(r => ids.includes(r.id));
  hit.forEach(r => used.add(r));
  const weekly = Array(WEEKS).fill(0);
  hit.forEach(r => r.weekly.forEach((v, i) => { weekly[i] += v; }));
  const last = hit.map(r => r.last).filter(Boolean).sort().pop();
  if (!last && !p.alwaysShow) continue;
  const isPrivate = hit.length ? hit.some(r => r.isPrivate) : p.visibility !== "public";
  projects.push({
    alias: p.alias, category: p.category, summary: p.summary, tags: p.tags || [],
    org: p.org || null, visibility: isPrivate ? "private" : "public",
    url: !isPrivate && hit.length === 1 ? hit[0].url : null,
    caseId: p.caseId || null, badge: p.badge || null, weekly, lastActive: last ? weekStart(last) : null
  });
}

if (cfg.includeUnlistedPublic) {
  for (const r of repos) {
    if (used.has(r) || r.isPrivate || r.account !== "p" || !r.last) continue;
    used.add(r);
    projects.push({ alias: r.name.split("/")[1], category: "Personal", summary: "", tags: [], org: null,
      visibility: "public", url: r.url, caseId: null, weekly: r.weekly, lastActive: weekStart(r.last) });
  }
}

projects.sort((a, b) => (b.lastActive || "").localeCompare(a.lastActive || ""));
const otherWork = repos.filter(r => !used.has(r)).reduce((s, r) => s + r.weekly.reduce((x, y) => x + y, 0), 0);

const out = {
  generatedAt: to.toISOString(),
  sample: false,
  days: [...days.values()].sort((a, b) => a.d.localeCompare(b.d)),
  projects: projects.slice(0, cfg.maxProjects || 6),
  otherWork
};
const json = JSON.stringify(out);

// Leak guard: refuse to publish if any private repo name or the work login appears in the output.
const lower = json.toLowerCase();
for (const r of repos.filter(x => x.isPrivate)) {
  for (const part of [r.name, r.name.split("/")[1], r.name.split("/")[0]]) {
    if (part.length >= 4 && lower.includes(part.toLowerCase())) {
      throw new Error("Refusing to publish: the output mentions a private repository or its owner. Rename the alias or summary.");
    }
  }
}
if (env.WORK_LOGIN && lower.includes(env.WORK_LOGIN.toLowerCase())) {
  throw new Error("Refusing to publish: the output mentions the work account login.");
}

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(new URL("../data/activity.json", import.meta.url), json);
console.log(`Wrote ${out.days.length} days and ${out.projects.length} projects.`);
