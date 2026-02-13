# Auto-deploy with GitHub

When you **push to the `main` branch**, GitHub Actions deploys this app to Fly.io. No need to run `flyctl deploy` manually.

## One-time setup

### 1. Create a Fly deploy token

In a terminal (with Fly CLI on your PATH):

```bash
flyctl tokens create deploy -x 999999h
```

Copy the token it prints (you won’t see it again).

### 2. Add the token to GitHub

1. Open your repo on GitHub.
2. Go to **Settings** → **Secrets and variables** → **Actions**.
3. Click **New repository secret**.
4. Name: `FLY_API_TOKEN`
5. Value: paste the token from step 1.
6. Save.

### 3. Push to `main`

From your project folder:

```bash
git add .
git commit -m "Your message"
git push origin main
```

The **Fly Deploy** workflow will run and deploy to Fly. Check the **Actions** tab on GitHub for status.

---

**Note:** The workflow runs on pushes to `main` only. If you use another default branch (e.g. `master`), either push to `main` for deploys or change the `branches` in `.github/workflows/fly-deploy.yml` to match your branch.
