# clips-instagram

Daily Instagram Reel poster for short clips cut from YouTube videos. Same structure as
`Aditya-040/proqen-instagram`, but the queue holds finished videos instead of rendered images.

## How a Reel gets here

1. On the PC: `python d:\ProqenSolutions\videoclip\autopost\autopost.py <youtube-url>`
   (needs the local OpenShorts Docker stack running).
2. OpenShorts cuts ~10 vertical 25–35 s clips with burned captions and a hook; Gemini writes one
   caption per clip from its transcript.
3. `autopost.py` re-encodes the audio to 48 kHz (Reels limit; video stream copied), copies each clip
   to `queue/rNNN.mp4`, writes a cover `queue/rNNN.jpg` (clip frame + big "GTA 5"/"GTA 6" label + hook line), appends `{id, video, cover, caption, source}` to `queue/manifest.json`, commits and pushes.

## Posting (`scripts/post.mjs`, `.github/workflows/post.yml`)

- Instagram API with Instagram login (`graph.instagram.com`): creates a `REELS` container from the
  clip's raw.githubusercontent URL (plus `cover_url` for the cover jpg) (this repo must stay **public** for that), waits for `FINISHED`
  (up to 10 min), publishes, records `{id, media_id, date}` in `state/posted.json`, then deletes the
  posted mp4 from `queue/`.
- Up to `POSTS_PER_DAY` (10) Reels per posting day, one every 30 minutes on the :00/:30 clock, all
  inside one workflow run (12:00–4:30 PM IST). The run pulls before each post and commits after it;
  `post.mjs` exits 3 when today's quota is used or the queue is empty, which ends the loop. The posting
  day is IST rolling over at 6 AM.
- Token: refreshed weekly and saved back to the `IG_ACCESS_TOKEN` secret via `GH_PAT`. Tokens are masked.
- Triggers: push to `trigger/**` (daily Claude scheduled task at 12:00 PM IST), backup crons at
  12:10 / 1:40 PM IST (they only post what today is still missing), and `workflow_dispatch` with
  `force` (one extra post) / `dry_run`.
- Secrets: `IG_USER_ID`, `IG_ACCESS_TOKEN` (starts with `IG`, not `EAA`), `GH_PAT`
  (fine-grained, this repo only, "Secrets: Read and write").

## Caption rules

Hook line (quote from the clip or bold statement, 1–2 emojis) → 2–3 short emotional lines about what
is actually said in the clip → CTA (question / save this / tag a friend) ending 👇 → 10–12 hashtags.
Never invent facts that are not in the clip. Gemini tags each clip GTA 5 / GTA 6 (GTA Online = GTA 5)
from the video title + clip; the hook line always names the game and the hashtags carry #GTA5 / #GTA6.

## Refill

When the action warns "Only N Reel(s) left", run `autopost.py` with a new link. Posted videos stay in
git history; if the repo grows past ~1 GB, squash history or start a fresh repo.
