// Publishes the next unposted Reel from queue/manifest.json to Instagram.
// Runs in GitHub Actions. Needs secrets IG_USER_ID and IG_ACCESS_TOKEN.
// Optional secret GH_PAT (fine-grained token with "Secrets: read & write" on this repo)
// lets it save a refreshed Instagram token automatically.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const API = "https://graph.instagram.com/v23.0";
const clean = (v) => (v || "").trim().replace(/^["']|["']$/g, "").trim();
const USER = clean(process.env.IG_USER_ID);
let TOKEN = clean(process.env.IG_ACCESS_TOKEN);
const REPO = process.env.GITHUB_REPOSITORY; // owner/name
const BRANCH = process.env.GITHUB_REF_NAME || "main";
const FORCE = process.env.FORCE === "true";
const DRY = process.env.DRY_RUN === "true";
const PER_DAY = Number(process.env.POSTS_PER_DAY || 16);
const DONE = 3; // exit code: nothing left to post today, the workflow loop stops

if (!USER || !TOKEN) fail("Missing IG_USER_ID or IG_ACCESS_TOKEN secret.");
console.log(`::add-mask::${TOKEN}`);
if (TOKEN.startsWith("EAA")) fail("IG_ACCESS_TOKEN is a Facebook token (starts with EAA). Generate the token under Instagram API > 'API setup with Instagram login' > 'Generate access tokens' instead; that one starts with IG.");

const manifest = JSON.parse(readFileSync("queue/manifest.json", "utf8"));
const state = JSON.parse(readFileSync("state/posted.json", "utf8"));
// "Posting day" in IST, rolling over at 6 AM instead of midnight, so a run delayed past midnight
// still counts for the evening it belongs to (and doesn't block the next evening's post).
const todayIST = new Date(Date.now() + (5.5 - 6) * 3600e3).toISOString().slice(0, 10);

function fail(msg) { msg = String(msg); if (TOKEN) msg = msg.replaceAll(TOKEN, "***"); console.log("::error title=Instagram post failed::" + msg.replace(/\n/g, " ")); process.exit(1); }
function warn(msg) { console.log("::warning::" + msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rawUrl = (p) => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${p}`;

async function ig(method, path, params = {}) {
  const url = new URL(API + path);
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const res = method === "GET"
    ? await fetch(url + "?" + body)
    : await fetch(url, { method, body });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`${path}: ${JSON.stringify(json.error || json)}`);
  return json;
}

async function waitReady(id) {
  // Instagram transcodes the video before it can be published: minutes, not seconds.
  for (let i = 0; i < 60; i++) {
    const { status_code, status } = await ig("GET", `/${id}`, { fields: "status_code,status" });
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`container ${id} ${status_code}: ${status || ""}`);
    await sleep(10000);
  }
  throw new Error(`container ${id} not ready after 10 minutes`);
}

async function refreshToken() {
  // Long-lived Instagram tokens last 60 days; refresh once a week to keep them alive.
  const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${TOKEN}`);
  const j = await res.json();
  if (!j.access_token) { warn("Token refresh failed: " + JSON.stringify(j.error || j)); return; }
  console.log(`🔑 Token refreshed, valid ~${Math.round(j.expires_in / 86400)} more days.`);
  if (j.access_token !== TOKEN) {
    console.log(`::add-mask::${j.access_token}`);
    TOKEN = j.access_token;
    if (process.env.GH_PAT) {
      try {
        // token goes in via stdin, never on the command line (command lines can end up in logs)
        execFileSync("gh", ["secret", "set", "IG_ACCESS_TOKEN", "--repo", REPO], {
          input: TOKEN, env: { ...process.env, GH_TOKEN: process.env.GH_PAT }, stdio: ["pipe", "ignore", "pipe"] });
        console.log("🔑 Saved new token to repo secret.");
      } catch (err) {
        const why = String(err.stderr || "").replaceAll(TOKEN, "***").split("\n")[0];
        warn("Couldn't save the refreshed token (GH_PAT needs 'Secrets: Read and write' on this repo): " + why);
      }
    } else {
      warn("Instagram issued a new token string but GH_PAT isn't set, so it can't be saved. Update IG_ACCESS_TOKEN manually within 60 days.");
    }
  }
  state.lastRefresh = todayIST;
}

async function main() {
  const daysSinceRefresh = state.lastRefresh ? (Date.parse(todayIST) - Date.parse(state.lastRefresh)) / 864e5 : 99;
  if (!DRY && daysSinceRefresh >= 7) await refreshToken();

  // forced posts (manual tests / extras) don't use up the day's scheduled slots
  const postedToday = state.posted.filter((p) => p.date === todayIST && !p.forced).length;
  if (postedToday >= PER_DAY && !FORCE) {
    console.log(`Already posted ${postedToday}/${PER_DAY} today (${todayIST}). Nothing to do.`);
    save(); process.exit(DONE);
  }
  const done = new Set(state.posted.map((p) => p.id));
  const post = manifest.find((p) => !done.has(p.id));
  if (!post && postedToday) { warn(`Queue ran out after ${postedToday} post(s) today. Run autopost.py with a new YouTube link.`); save(); process.exit(DONE); }
  if (!post) { warn("Queue is empty: waiting for autopost.py --refill to add Reels."); save(); process.exit(DONE); }
  if (!existsSync(post.video)) fail(`${post.id}: ${post.video} is missing from the repo.`);
  const left = manifest.filter((p) => !done.has(p.id)).length - 1;
  console.log(`Posting ${post.id} (${post.video}). ${left} left in queue after this.`);
  if (DRY) { console.log("  ", rawUrl(post.video)); console.log(post.caption); process.exit(DONE); }

  const cover = post.cover && existsSync(post.cover) ? { cover_url: rawUrl(post.cover) } : {};
  const c = await ig("POST", `/${USER}/media`, {
    media_type: "REELS", video_url: rawUrl(post.video), caption: post.caption, share_to_feed: "true", ...cover });
  await waitReady(c.id);
  const pub = await ig("POST", `/${USER}/media_publish`, { creation_id: c.id });
  console.log(`✅ Published ${post.id} → media id ${pub.id}`);
  const entry = { id: post.id, media_id: pub.id, date: todayIST, ...(FORCE && { forced: true }) };
  state.posted.push(entry);
  save(); // the Reel is live: record it before anything else can fail
  try {
    const yt = await youtube(post);
    if (yt) { entry.youtube = yt.id; console.log(`▶️ YouTube Short ${yt.id} (${yt.privacy})`); }
  } catch (e) { warn(`${post.id}: YouTube upload failed (the Reel is posted): ${e.message}`); }
  rmSync(post.video); // posted: drop it from the tree so the queue folder stays small
  if (cover.cover_url) rmSync(post.cover);
  save();
  if (left < 3) warn(`Only ${left} Reel(s) left in the queue.`);
}

// Same video as a YouTube Short. Needs secrets YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN
// (made once with autopost\youtube_auth.py); without them this is skipped.
async function youtube(post) {
  const { YT_CLIENT_ID: id, YT_CLIENT_SECRET: secret, YT_REFRESH_TOKEN: refresh } = process.env;
  if (!id || !secret || !refresh) return null;
  const tok = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }) })).json();
  if (!tok.access_token) throw new Error("token refresh: " + JSON.stringify(tok.error_description || tok.error || tok));
  console.log(`::add-mask::${tok.access_token}`);
  const clean = (s) => s.replace(/[<>]/g, ""); // YouTube rejects angle brackets in titles/descriptions
  const lines = post.caption.split("\n").map((s) => s.trim()).filter(Boolean);
  const title = clean(lines[0].replace(/#\S+/g, "").trim()).slice(0, 90).trim() + " #Shorts";
  // SEO: content keywords + hashtags as tags. Tags are searchable but never shown to viewers.
  const tags = [];
  for (const t of [...(post.keywords || []), ...[...post.caption.matchAll(/#(\w+)/g)].map((m) => m[1])]) {
    const tag = clean(String(t)).replace(/,/g, " ").trim();
    if (!tag || tags.some((x) => x.toLowerCase() === tag.toLowerCase())) continue;
    // YouTube's 500-char tag budget counts a comma between tags and quotes around tags with spaces
    if ([...tags, tag].reduce((n, x) => n + x.length + (x.includes(" ") ? 2 : 0) + 1, 0) > 480) break;
    tags.push(tag);
  }
  const video = readFileSync(post.video);
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json; charset=UTF-8",
               "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(video.length) },
    body: JSON.stringify({
      snippet: { title, description: clean(post.caption) + "\n\n#Shorts", tags, categoryId: "20" }, // 20 = Gaming
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false } }) });
  if (!init.ok) throw new Error(`upload start ${init.status}: ${(await init.text()).slice(0, 300)}`);
  const up = await fetch(init.headers.get("location"), { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: video });
  const j = await up.json();
  if (!up.ok) throw new Error(`upload ${up.status}: ${JSON.stringify(j.error || j).slice(0, 300)}`);
  return { id: j.id, privacy: j.status?.privacyStatus };
}

function save() { writeFileSync("state/posted.json", JSON.stringify(state, null, 2) + "\n"); }

main().catch((e) => { save(); fail(e.message); });
