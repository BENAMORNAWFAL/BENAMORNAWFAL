import { readFile, writeFile } from "node:fs/promises";

const owner = process.env.GITHUB_REPOSITORY_OWNER || "BENAMORNAWFAL";
const token = process.env.GITHUB_TOKEN;
const api = "https://api.github.com";
const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function github(path) {
  const response = await fetch(`${api}${path}`, { headers });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${path}`);
  return response.json();
}

const config = JSON.parse(await readFile("profile/projects.json", "utf8"));
const [profile, repositories] = await Promise.all([
  github(`/users/${owner}`),
  github(`/users/${owner}/repos?type=owner&per_page=100&sort=updated`),
]);

const publicRepos = repositories.filter(repo =>
  !repo.private &&
  (!config.excludeForks || !repo.fork) &&
  (!config.excludeArchived || !repo.archived)
);

const languagesByRepo = await Promise.all(publicRepos.map(async repo => {
  try {
    return { repo, languages: await github(`/repos/${owner}/${repo.name}/languages`) };
  } catch (error) {
    console.warn(`Skipping language data for ${repo.name}: ${error.message}`);
    return { repo, languages: {} };
  }
}));

const totals = {};
for (const item of languagesByRepo) {
  for (const [language, bytes] of Object.entries(item.languages)) {
    totals[language] = (totals[language] || 0) + bytes;
  }
}
const sortedLanguages = Object.entries(totals).sort((a,b) => b[1]-a[1]);
const totalBytes = sortedLanguages.reduce((sum, [, bytes]) => sum + bytes, 0);
const topLanguages = sortedLanguages.slice(0, config.maxLanguages || 8);
const stars = publicRepos.reduce((sum, repo) => sum + repo.stargazers_count, 0);
const forks = publicRepos.reduce((sum, repo) => sum + repo.forks_count, 0);

const featured = (config.featuredRepositories || [])
  .map(name => publicRepos.find(repo => repo.name.toLowerCase() === name.toLowerCase()))
  .filter(Boolean);

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function percent(bytes) {
  return totalBytes ? (bytes / totalBytes * 100) : 0;
}

const palette = ["#3178c6","#f1e05a","#3572A5","#e34c26","#563d7c","#00ADD8","#dea584","#b07219"];
const bars = topLanguages.map(([name, bytes], index) => {
  const width = percent(bytes);
  const y = 205 + index * 6;
  const label = escapeHtml(name);
  return `<text x="32" y="${y}" fill="#c9d1d9" font-family="Arial,sans-serif" font-size="10">${label}</text>
  <rect x="145" y="${y-8}" width="600" height="4" rx="2" fill="#21262d"/>
  <rect x="145" y="${y-8}" width="${(600*width/100).toFixed(1)}" height="4" rx="2" fill="${palette[index % palette.length]}"/>
  <text x="755" y="${y}" fill="#8b949e" font-family="Arial,sans-serif" font-size="10">${width.toFixed(1)}%</text>`;
}).join("");
