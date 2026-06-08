# ⚡ QCom Intel — India Commerce News Engine

A static news aggregation site that auto-refreshes daily via GitHub Actions, hosted on GitHub Pages. Tracks Quick Commerce, Ecommerce, FMCG, Retail Tech, and Funding news from Indian business publications.

## What it does

- Fetches RSS feeds from ET, Mint, Inc42, YourStory, Entrackr, Business Standard, Financial Express daily
- Filters articles by topic keyword matching
- Deduplicates, sorts newest-first, stores in `data/articles.json`
- Renders a clean editorial UI with search, topic tabs, and date filters
- Falls back to seed data if no live articles are fetched
- Bookmarks persist via localStorage
- Dark mode supported

---

## Repo Structure

```
/
  index.html              # Main site HTML
  assets/
    styles.css            # All styles
    app.js                # Frontend logic
  data/
    articles.json         # Generated daily — DO NOT edit manually
    topics.json           # Topic keyword config
    sources.json          # RSS feed list + settings
  scripts/
    fetch_news.py         # Fetch + filter + write pipeline
  .github/
    workflows/
      daily-refresh.yml   # GitHub Actions workflow
  README.md
  .gitignore
```

---

## Deploy to GitHub Pages

### Step 1 — Create the repo
1. Create a new GitHub repo (public or private)
2. Push all files from this folder to the `main` branch

### Step 2 — Enable GitHub Pages
1. Go to **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / `/ (root)`
4. Save

Your site will be live at: `https://<your-username>.github.io/<repo-name>/`

### Step 3 — Enable GitHub Actions
1. Go to **Actions** tab
2. If prompted, enable workflows
3. Click **"Daily News Refresh"** → **"Run workflow"** to test immediately

The action will:
- Run `scripts/fetch_news.py`
- Commit updated `data/articles.json` back to the repo
- GitHub Pages will auto-deploy the new version

---

## Adding More Keywords

Edit `data/topics.json`. Each topic has an `id`, `label`, and `keywords` array:

```json
{
  "id": "adtech",
  "label": "AdTech",
  "color": "#ef4444",
  "keywords": ["ad tech", "retail media", "programmatic", "adtech", "DSP"]
}
```

The fetch script and frontend will both pick it up automatically.

---

## Adding / Changing RSS Feeds

Edit `data/sources.json`. Add a new entry to the `feeds` array:

```json
{
  "name": "Blume Ventures Blog",
  "url": "https://blume.vc/feed/",
  "source": "Blume Ventures",
  "active": true
}
```

Set `"active": false` to disable a feed without deleting it.

---

## Changing Fetch Settings

In `data/sources.json` under `settings`:

```json
{
  "max_articles": 150,
  "max_age_days": 7,
  "fetch_timeout_seconds": 15,
  "min_relevance_keywords": 1
}
```

---

## Using API Keys / Secrets (Future)

If you add a source that needs an API key:

1. Go to **Settings → Secrets and variables → Actions**
2. Add a secret, e.g. `NEWSAPI_KEY`
3. In the workflow, it's available as `${{ secrets.NEWSAPI_KEY }}`
4. Pass it as an environment variable in `daily-refresh.yml`:

```yaml
- name: Run news fetch script
  env:
    NEWSAPI_KEY: ${{ secrets.NEWSAPI_KEY }}
  run: python scripts/fetch_news.py
```

5. Read it in `fetch_news.py` with `os.environ.get("NEWSAPI_KEY")`

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Site shows "sample articles" warning | The GitHub Action hasn't run yet. Trigger it manually from the Actions tab. |
| No articles showing for a topic | Keywords may not match feed content. Add broader terms to `topics.json`. |
| Feed fetch failing | Check the feed URL is still valid. RSS URLs change. Set `"active": false` for broken feeds. |
| Action not running on schedule | GitHub disables scheduled actions on inactive repos. Manually trigger once a week if needed. |
| Dark mode not persisting | Check browser localStorage isn't being cleared. |

---

## Stack

- **Frontend**: Vanilla HTML/CSS/JS — no framework
- **Fonts**: Space Mono + DM Sans (Google Fonts)
- **Fetch pipeline**: Python 3.11 (stdlib only — no pip installs needed)
- **Hosting**: GitHub Pages (static)
- **Automation**: GitHub Actions (cron + manual trigger)

---

Built for QCom operators. Refresh daily, stay sharp.
