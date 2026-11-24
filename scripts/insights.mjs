// Prints views/reach/likes of the last N posted Reels (Instagram) and their YouTube Shorts.
// Runs in GitHub Actions (workflow insights.yml) because the tokens live in repo secrets.
import { readFileSync } from "node:fs";

const N = Number(process.env.N || 40);
const TOKEN = (process.env.IG_ACCESS_TOKEN || "").trim();
console.log(`::add-mask::${TOKEN}`);
const posted = JSON.parse(readFileSync("state/posted.json", "utf8")).posted.slice(-N);
const manifest = Object.fromEntries(JSON.parse(readFileSync("queue/manifest.json", "utf8")).map((p) => [p.id, p]));

async function ig(id) {
  const u = `https://graph.instagram.com/v23.0/${id}/insights?metric=views,reach,likes,comments,shares,saved&access_token=${TOKEN}`;
  const j = await (await fetch(u)).json();
  if (j.error) return { err: j.error.message.slice(0, 60) };
  return Object.fromEntries((j.data || []).map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0]));
}

async function ytStats(ids) {
  const { YT_CLIENT_ID: id, YT_CLIENT_SECRET: secret, YT_REFRESH_TOKEN: refresh } = process.env;
  if (!id || !ids.length) return {};
  const tok = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }) })).json();
  if (!tok.access_token) return {};
  console.log(`::add-mask::${tok.access_token}`);
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const j = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.slice(i, i + 50).join(",")}`,
      { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
    for (const v of j.items || []) out[v.id] = v.statistics;
  }
  return out;
}

const yt = await ytStats(posted.map((p) => p.youtube).filter(Boolean));
const rows = [];
for (const p of posted) {
  const s = await ig(p.media_id);
  const hook = (manifest[p.id]?.caption || "").split("\n")[0].slice(0, 70);
  rows.push({ id: p.id, date: p.date, ig_views: s.views ?? "-", reach: s.reach ?? "-", likes: s.likes ?? "-",
    shares: s.shares ?? "-", saves: s.saved ?? "-", yt_views: p.youtube ? (yt[p.youtube]?.viewCount ?? "?") : "-",
    hook: s.err ? `ERR ${s.err}` : hook });
}
console.table(rows);
const v = rows.map((r) => Number(r.ig_views) || 0);
console.log(`Instagram: total ${v.reduce((a, b) => a + b, 0)} views over ${v.length} Reels, median ${v.sort((a, b) => a - b)[Math.floor(v.length / 2)]}`);
