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
  return `<div style="display:flex;align-items:center;gap:12px;margin:9px 0;font-size:13px">
    <span style="width:105px;color:#c9d1d9">${escapeHtml(name)}</span>
    <div style="height:9px;flex:1;background:#21262d;border-radius:8px;overflow:hidden">
      <div style="height:9px;width:${width.toFixed(2)}%;background:${palette[index % palette.length]};border-radius:8px"></div>
    </div>
    <span style="width:48px;text-align:right;color:#8b949e">${width.toFixed(1)}%</span>
  </div>`;
}).join("");

const statsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="260" viewBox="0 0 900 260">
<rect width="900" height="260" rx="16" fill="#0d1117" stroke="#30363d"/>
<text x="30" y="42" fill="#f0f6fc" font-family="Arial,sans-serif" font-size="21" font-weight="700">GitHub overview</text>
<g font-family="Arial,sans-serif">
<text x="32" y="91" fill="#8b949e" font-size="13">PUBLIC REPOSITORIES</text><text x="32" y="127" fill="#58a6ff" font-size="29" font-weight="700">${publicRepos.length}</text>
<text x="245" y="91" fill="#8b949e" font-size="13">STARS EARNED</text><text x="245" y="127" fill="#58a6ff" font-size="29" font-weight="700">${stars}</text>
<text x="450" y="91" fill="#8b949e" font-size="13">FORKS</text><text x="450" y="127" fill="#58a6ff" font-size="29" font-weight="700">${forks}</text>
<text x="655" y="91" fill="#8b949e" font-size="13">FOLLOWERS</text><text x="655" y="127" fill="#58a6ff" font-size="29" font-weight="700">${profile.followers}</text>
<text x="32" y="180" fill="#f0f6fc" font-size="15" font-weight="700">Top languages by code volume</text>
</g>
<foreignObject x="32" y="190" width="836" height="65"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif">${bars}</div></foreignObject>
</svg>`;
await writeFile("assets/github-overview.svg", statsSvg);

const languageLine = topLanguages.length
  ? topLanguages.map(([name]) => `<img alt="${escapeHtml(name)}" src="https://img.shields.io/badge/${encodeURIComponent(name)}-informational?style=flat-square" />`).join(" ")
  : "_No public language data available yet._";

const projectRows = featured.length ? featured.map(repo => {
  const description = repo.description || "Public repository";
  const lang = repo.language || "Not specified";
  const updated = new Date(repo.pushed_at).toISOString().slice(0,10);
  return `| [**${escapeHtml(repo.name)}**](${repo.html_url}) | ${escapeHtml(description)} | ${escapeHtml(lang)} | ⭐ ${repo.stargazers_count} | ${updated} |`;
}).join("\n") : "| No curated public repositories found | Update `profile/projects.json` | — | — | — |";

const generated = `### 📌 Featured Projects

These projects are intentionally curated. Their descriptions, primary languages, stars and last-push dates refresh automatically.

| Project | Description | Primary language | Stars | Last update |
|---|---|---:|---:|---:|
${projectRows}

### 📊 GitHub Statistics

<p align="center">
  <img src="./assets/github-overview.svg" alt="Automatically generated GitHub statistics and language distribution" width="100%" />
</p>

### 💻 Languages detected from public repositories

${languageLine}

<sub>Generated automatically from GitHub repository metadata and language byte counts. Private repositories are never queried or displayed.</sub>`;

const readmePath = "README.md";
let readme = await readFile(readmePath, "utf8");
const start = "<!-- PROFILE-AUTO-START -->";
const end = "<!-- PROFILE-AUTO-END -->";
if (!readme.includes(start) || !readme.includes(end)) {
  throw new Error("README.md is missing the PROFILE-AUTO-START/END markers; refusing to overwrite content.");
}
const before = readme.slice(0, readme.indexOf(start) + start.length);
const after = readme.slice(readme.indexOf(end));
readme = `${before}\n\n${generated}\n\n${after}`;
await writeFile(readmePath, readme);
console.log(`Updated profile: ${publicRepos.length} public repositories, ${featured.length} curated projects, ${topLanguages.length} languages.`);
