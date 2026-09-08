import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USERNAME = process.env.GITHUB_USERNAME || "alexsandsouza";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const QUERY = `
query ($login: String!) {
  user(login: $login) {
    pullRequests { totalCount }
    issues { totalCount }
    repositoriesContributedTo(
      contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]
      first: 1
    ) { totalCount }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
    }
    repositories(
      first: 100
      ownerAffiliations: OWNER
      isFork: false
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges {
            size
            node { name color }
          }
        }
      }
    }
  }
}
`;

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function rankFromScore(score) {
  if (score >= 20000) return "S";
  if (score >= 8000) return "A+";
  if (score >= 4000) return "A";
  if (score >= 2000) return "B+";
  if (score >= 800) return "B";
  if (score >= 300) return "C+";
  return "C";
}

async function githubGraphql(query, variables) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "alexsandsouza-stats",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }
  return payload.data;
}

function renderStatsCard({ stars, commits, prs, issues, contributed, rank }) {
  const rows = [
    ["Total de estrelas", formatNumber(stars)],
    ["Total de Commits (Ano passado)", formatNumber(commits)],
    ["Total de PRs", formatNumber(prs)],
    ["Total de Issues", formatNumber(issues)],
    ["Contribuiu para (ano passado)", formatNumber(contributed)],
  ];

  const rowSvg = rows
    .map(
      ([label, value], index) => `
      <g transform="translate(25, ${54 + index * 24})">
        <text class="stat" x="0" y="12.5">${escapeXml(label)}:</text>
        <text class="stat" x="310" y="12.5" text-anchor="end">${escapeXml(value)}</text>
      </g>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" role="img" aria-label="Estatísticas do GitHub de ${escapeXml(USERNAME)}">
  <style>
    .title { font: 600 18px 'Segoe UI', Ubuntu, Sans-Serif; fill: #70a5fd; }
    .stat { font: 600 13px 'Segoe UI', Ubuntu, Sans-Serif; fill: #38bdae; }
    .rank { font: 800 36px 'Segoe UI', Ubuntu, Sans-Serif; fill: #2cdcff; }
  </style>
  <rect width="495" height="195" rx="4.5" fill="#1a1b27" stroke="#2e344e"/>
  <g transform="translate(25, 35)">
    <text class="title">Estatísticas do GitHub de ${escapeXml(USERNAME)}</text>
  </g>
  ${rowSvg}
  <g transform="translate(410, 108)">
    <circle r="38" fill="none" stroke="#2e344e" stroke-width="6"/>
    <circle r="38" fill="none" stroke="#2cdcff" stroke-width="6" stroke-dasharray="160 80" transform="rotate(-90)"/>
    <text class="rank" text-anchor="middle" dy="12">${escapeXml(rank)}</text>
  </g>
</svg>
`;
}

function renderLangsCard(languages) {
  const total = languages.reduce((sum, language) => sum + language.size, 0) || 1;
  let offset = 0;
  const bars = languages
    .map((language) => {
      const width = (language.size / total) * 430;
      const rect = `<rect x="${offset.toFixed(2)}" width="${width.toFixed(2)}" height="8" fill="${escapeXml(language.color || "#8b949e")}"/>`;
      offset += width;
      return rect;
    })
    .join("");

  const legend = languages
    .map((language, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const percent = ((language.size / total) * 100).toFixed(2);
      return `
      <g transform="translate(${column * 220}, ${row * 24})">
        <circle cx="6" cy="6" r="6" fill="${escapeXml(language.color || "#8b949e")}"/>
        <text class="lang" x="18" y="10">${escapeXml(language.name)} ${percent}%</text>
      </g>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" role="img" aria-label="Linguagens mais usadas">
  <style>
    .title { font: 600 18px 'Segoe UI', Ubuntu, Sans-Serif; fill: #70a5fd; }
    .lang { font: 600 12px 'Segoe UI', Ubuntu, Sans-Serif; fill: #38bdae; }
  </style>
  <rect width="495" height="195" rx="4.5" fill="#1a1b27" stroke="#2e344e"/>
  <g transform="translate(25, 35)">
    <text class="title">Linguagens mais usadas</text>
  </g>
  <g transform="translate(25, 62)">${bars}</g>
  <g transform="translate(25, 92)">${legend}</g>
</svg>
`;
}

function bumpReadmeCache(readmePath, version) {
  if (!fs.existsSync(readmePath)) return;
  const current = fs.readFileSync(readmePath, "utf8");
  const next = current.replaceAll(/(\.\/assets\/github-(?:stats|langs)\.svg)\?v=\d+/g, `$1?v=${version}`);
  if (next !== current) {
    fs.writeFileSync(readmePath, next);
  }
}

async function main() {
  const data = await githubGraphql(QUERY, { login: USERNAME });
  const user = data.user;
  if (!user) throw new Error(`Usuário ${USERNAME} não encontrado`);

  const stars = user.repositories.nodes.reduce((sum, repo) => sum + repo.stargazerCount, 0);
  const commits =
    user.contributionsCollection.totalCommitContributions +
    user.contributionsCollection.restrictedContributionsCount;
  const prs = user.pullRequests.totalCount;
  const issues = user.issues.totalCount;
  const contributed = user.repositoriesContributedTo.totalCount;
  const score = stars * 2 + commits + prs * 2 + issues + contributed;
  const rank = rankFromScore(score);

  const languageMap = new Map();
  for (const repo of user.repositories.nodes) {
    for (const edge of repo.languages.edges) {
      const current = languageMap.get(edge.node.name) || { name: edge.node.name, color: edge.node.color, size: 0 };
      current.size += edge.size;
      languageMap.set(edge.node.name, current);
    }
  }

  const languages = [...languageMap.values()].sort((a, b) => b.size - a.size).slice(0, 6);

  const assetsDir = path.join(ROOT, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, "github-stats.svg"), renderStatsCard({ stars, commits, prs, issues, contributed, rank }));
  fs.writeFileSync(path.join(assetsDir, "github-langs.svg"), renderLangsCard(languages));

  const version = process.env.GITHUB_RUN_NUMBER || String(Date.now());
  bumpReadmeCache(path.join(ROOT, "README.md"), version);

  console.log(
    JSON.stringify(
      { stars, commits, prs, issues, contributed, rank, languages: languages.map((item) => item.name) },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
