# NIM Chat — NVIDIA NIM on Cloudflare Pages

A mobile-first, dark-themed chat UI backed by NVIDIA NIM, hosted entirely on Cloudflare Pages with API key protection via Pages Functions.

---

## Project Structure

```
/
├── index.html              # App shell
├── style.css               # Dark-theme styles (CSS variables)
├── app.js                  # Frontend logic & state
└── functions/
    └── api/
        ├── models.js       # GET  /api/models  → proxies NIM model list
        └── chat.js         # POST /api/chat    → proxies NIM completions
```

---

## Deploying to Cloudflare Pages

### 1. Connect your repository

Push this project to a GitHub/GitLab repo, then:

1. Go to **Cloudflare Dashboard → Workers & Pages → Create application → Pages**
2. Connect your Git provider and select the repository
3. Build settings:
   - **Framework preset**: None
   - **Build command**: *(leave empty)*
   - **Build output directory**: `/` (root)

### 2. Set your environment variable

In **Settings → Environment variables**, add:

| Variable name         | Value                  | Environment      |
|-----------------------|------------------------|------------------|
| `NVIDIA_NIM_API_KEY`  | `nvapi-xxxxxxxxxxxx`   | Production       |

> For local development, create a `.dev.vars` file (gitignored) with:
> ```
> NVIDIA_NIM_API_KEY=nvapi-xxxxxxxxxxxx
> ```

### 3. Deploy

Push a commit — Cloudflare Pages will build and deploy automatically.

---

## Local Development

Install Wrangler CLI and run:

```bash
npm install -g wrangler
wrangler pages dev . --compatibility-date=2024-09-23
```

Then open `http://localhost:8788`.

---

## Features

| Feature | Details |
|---|---|
| **Model selection** | Fetched live from NIM, persisted to localStorage |
| **System persona** | Custom system prompt prepended to every conversation |
| **Streaming responses** | SSE passthrough from NIM to browser |
| **Context management** | Full message history sent on each turn |
| **Markdown rendering** | Code blocks, bold, lists, blockquotes via marked.js |
| **Mobile-first** | Safe area insets, auto-expanding input, touch-optimised |
| **Dark theme** | CSS variables — easy to re-theme |
| **No API key in browser** | Key lives only in Cloudflare env vars |

---

## Customisation

Edit the `:root` CSS variables in `style.css` to re-theme. The `--accent` colour (`#76b900`, NVIDIA green) and background values are the primary levers.
