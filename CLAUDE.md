# clips-instagram

Daily Instagram Reel poster for short clips cut from YouTube videos. Same structure as
`Aditya-040/proqen-instagram`, but the queue holds finished videos instead of rendered images.

## How a Reel gets here

1. On the PC: `python d:\ProqenSolutions\videoclip\autopost\autopost.py <youtube-url>`
   (needs the local OpenShorts Docker stack running).
2. OpenShorts cuts ~10 vertical 25–35 s clips with burned captions and a hook; Gemini writes one
   caption per clip from its transcript.
3. `autopost.py` puts the clip's best 3 s (Gemini's pick) in front as a cold-open teaser, re-encodes
   (audio 48 kHz, the Reels limit), copies each clip
   to `queue/rNNN.mp4`, writes a cover `queue/rNNN.jpg` (AI art from `IMAGE_MODEL` when the Gemini key has billing, else the punched-up best frame; plus a big
   "GTA 5"/"GTA 6" label and 2-5 word cover text), appends `{id, video, cover, caption, source}` to `queue/manifest.json`, commits and pushes.

## Posting (`scripts/post.mjs`, `.github/workflows/post.yml`)

- Instagram API with Instagram login (`graph.instagram.com`): creates a `REELS` container from the
  clip's raw.githubusercontent URL (plus `cover_url` for the cover jpg) (this repo must stay **public** for that), waits for `FINISHED`
  (up to 10 min), publishes, records `{id, media_id, date}` in `state/posted.json`, then deletes the
  posted mp4 from `queue/`.
- Non-stop: a cron run at :05/:35 every hour posts one Reel (`ONE_SHOT`), up to `POSTS_PER_DAY` (46,
  under Instagram's 50/24h API limit) per posting day (IST, rolling over at 6 AM). A manual
  `workflow_dispatch` run still loops every 30 min. `post.mjs` exits 3 when the quota is used or the
  queue is empty (a warning, not a failure). The queue is refilled from the user's PC by
  `autopost.py --refill` (hourly Windows task): links.txt first, else Creative Commons GTA 6 videos,
  credited to their channel.
- Token: refreshed weekly and saved back to the `IG_ACCESS_TOKEN` secret via `GH_PAT`. Tokens are masked.
- Triggers: the 30-minute cron, push to `trigger/**` (daily Claude scheduled task, one post), and
  `workflow_dispatch` with `per_day` / `force` (one extra post) / `dry_run`.
- Secrets: `IG_USER_ID`, `IG_ACCESS_TOKEN` (starts with `IG`, not `EAA`), `GH_PAT`
  (fine-grained, this repo only, "Secrets: Read and write").

## YouTube Shorts

After each Reel is published, `post.mjs` uploads the same mp4 to YouTube as a Short (title = hook line
+ `#Shorts`, description = caption, category Gaming) and records `youtube: <videoId>` in
`state/posted.json`. A YouTube failure only warns; the Reel stays posted. Secrets `YT_CLIENT_ID`,
`YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN` come from `autopost\youtube_auth.py` (one-time sign-in);
without them the upload is skipped. Unaudited Google Cloud projects get uploads locked to private,
and the default quota allows only a few uploads a day.

## Caption rules

Hook line (quote from the clip or bold statement, 1–2 emojis) → 2–3 short emotional lines about what
is actually said in the clip → CTA (question / save this / tag a friend) ending 👇 → 10–12 hashtags.
Never invent facts that are not in the clip. Gemini tags each clip GTA 5 / GTA 6 (GTA Online = GTA 5)
from the video title + clip; the hook line always names the game and the hashtags carry #GTA5 / #GTA6.

## Refill

When the action warns "Only N Reel(s) left", run `autopost.py` with a new link. Posted videos stay in
git history; if the repo grows past ~1 GB, squash history or start a fresh repo.
