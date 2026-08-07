# Deploy your own Portfolio Terminal 2 worker

Portfolio Terminal 2 is only the client half: it holds your portfolios and draws the interface, but every price, chart and lookup comes from a server, and that server is the worker. Without one the app has nothing to show — so each user runs their own copy, and this guide walks through creating it.

The worker (`worker.js`) is Portfolio Terminal 2's price backend and, optionally, the proxy for cloud sync via Cloudflare KV and the scheduler behind alert checks and push notifications.

## Choose a path

There are two ways to get the worker running. **Follow one of them and skip the other** — they configure the same things in different places, and mixing them causes settings to be silently overwritten.

**[Option A — from the dashboard](#option-a--from-the-dashboard).** Paste the code into Cloudflare's editor and set everything through the UI. Nothing to install, no accounts beyond Cloudflare. Updating means pasting the new code again.

**[Option B — from GitHub](#option-b--from-github).** Keep `worker.js` and `wrangler.toml` in a repository and let Cloudflare build on every push. Updates deploy themselves, and the configuration is version-controlled. Requires a GitHub (or GitLab) account.

Either way you'll need a [Cloudflare](https://cloudflare.com) account — the free plan is enough — and the `worker.js` file from this repository.

---

## Option A — from the dashboard

### Create the worker

1. **Create it.** Cloudflare dashboard → **Workers & Pages** → **Create** → **Create Worker**. Enter a name (this becomes part of the URL: `<name>.<subdomain>.workers.dev`). Click **Deploy** to create a stub.
2. **Paste the code.** Open the new worker → **Edit code**. Delete the stub content, paste `worker.js`, click **Deploy**.
3. **Set the API token.** Worker page → **Settings** → **Variables and Secrets** → **Add**. Choose type **Secret**, so the value can't be read back from the dashboard. Name: `API_TOKEN`. Value: any long random string. Save.

### Add cloud sync (optional)

Needed for the **Cloudflare KV** sync backend, and required if you want alert checks. Skip if you'll use JSONBin and don't want push notifications.

1. **Create a KV namespace.** Dashboard → **Workers & Pages** → **KV** → **Create a namespace**. Give it any name (e.g. `PT2`).
2. **Bind it.** Worker page → **Settings** → **Bindings** → **Add** → **KV Namespace**. Set **Variable name** to exactly `PORTFOLIO_KV` — the worker looks this binding up by name; anything else won't work. Select the namespace you just created. Save.

### Add alert checks and push (optional)

Lets the worker check your alerts on a schedule and notify you while the app is closed. Requires the KV step above.

1. **Generate a VAPID key pair.** Run `npx web-push generate-vapid-keys`. It prints a public and a private key. No Node available? See the [appendix](#appendix-generating-vapid-keys-without-npx).
2. **Add them.** Worker page → **Settings** → **Variables and Secrets**. Add `VAPID_PUBLIC_KEY` as a plaintext **Variable** — it's handed to every client anyway via `/api/push/key`. Add `VAPID_PRIVATE_KEY` as a **Secret**. Optionally add `VAPID_SUBJECT` as `mailto:you@example.com` — push services expect a contact address, and the worker falls back to a placeholder without it.
3. **Add a cron trigger.** Worker page → **Settings** → **Triggers** → **Cron Triggers** → **Add**. Use `*/5 * * * *`. The cron only wakes the worker; your in-app settings decide which checks actually run, so a frequent trigger is harmless and helps large watchlists finish a round sooner.

Now continue with [connecting the app](#connect-the-app).

---

## Option B — from GitHub

Here `wrangler.toml` is the source of truth: bindings, cron and plaintext variables all come from the file and are reapplied on every build. Anything of that kind set by hand in the dashboard is overwritten on the next push. Secrets are the exception — they live only in the dashboard and builds never touch them.

### Prepare the repository

1. **Get the files into a repo.** Fork this repository, or copy `worker.js` and `wrangler.toml` into your own.
2. **Create a KV namespace** (skip only if you want neither cloud sync nor push). Cloudflare dashboard → **Workers & Pages** → **KV** → **Create a namespace**, any name. Copy its **ID**.
3. **Generate a VAPID key pair** (skip if you don't want push). Run `npx web-push generate-vapid-keys`, or see the [appendix](#appendix-generating-vapid-keys-without-npx).
4. **Edit `wrangler.toml`.** The committed file carries the original author's values — every one of them has to be replaced:
   - `name` — your worker's name, which becomes part of its URL.
   - `id` under `[[kv_namespaces]]` — the namespace ID you just copied. Leave `binding = "PORTFOLIO_KV"` alone; the worker looks it up by that name.
   - `VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` under `[vars]` — your public key and your own `mailto:` address.

   Dropping a feature means dropping its block: remove `[[kv_namespaces]]` if you don't want KV, and `[triggers]` plus the two `[vars]` lines if you don't want push. A stale namespace ID breaks the build outright; a mismatched VAPID key fails quietly, at the first send.

### Connect and deploy

1. **Import the repository.** Cloudflare dashboard → **Workers & Pages** → **Create** → the import-from-Git option. Authorise Cloudflare's access to GitHub if you haven't before, pick the repository, and confirm. The first build starts immediately.
2. **Set the secrets.** These aren't in the file, so add them once the worker exists: worker page → **Settings** → **Variables and Secrets** → **Add**, type **Secret**. `API_TOKEN` — any long random string. `VAPID_PRIVATE_KEY` — the private key from step 3, if you set up push. Secrets survive later builds.

From here every push to the tracked branch rebuilds and redeploys. To change the cron schedule or the VAPID public key, edit `wrangler.toml` and push — not the dashboard.

Now continue with connecting the app.

---

## Connect the app

Same for both options.

1. **Point the app at the worker.** In Portfolio Terminal 2, Settings → **PROVIDER**: enter the worker URL and the `API_TOKEN` value.
2. **Cloud sync** (if you set up KV). Settings → **CLOUD STORAGE** → select **Cloudflare KV** → enter any unique **KV Key** (e.g. your username). This key identifies your data slot within the namespace. To check it works, click **↑ OVERWRITE CLOUD** — a clean run means the whole chain is wired.
3. **Encryption** (optional). Settings → **ENC KEY**, set any password. Portfolio data is then AES-GCM encrypted client-side before it reaches KV — the namespace stores only an opaque blob. The same password must be entered on every device that syncs; if you lose it, the cloud data can't be recovered.
4. **Push notifications** (if you set up VAPID and cron). Settings → **PUSH NOTIFICATIONS** → enable. Grant the browser's notification permission when asked, then set the check interval, the daily time window, and optionally the movers digest. The **TEST** button confirms delivery straight away. Repeat on every device you want notified.

Note: the alert record — thresholds and push subscriptions — is stored unencrypted, because the scheduled job has to read it. Your ENC KEY still protects the portfolio data itself; positions, quantities and prices are never written to this record.

## Appendix: generating VAPID keys without npx

VAPID keys are an ordinary ECDSA P-256 pair, so any browser can produce them. Open DevTools on any HTTPS page (the app itself will do) and run:

```js
const kp = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
);
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

console.log('VAPID_PUBLIC_KEY :', b64u(await crypto.subtle.exportKey('raw', kp.publicKey)));
console.log('VAPID_PRIVATE_KEY:', (await crypto.subtle.exportKey('jwk', kp.privateKey)).d);
```

Sanity check: the public key is 87 characters, the private key 43.

The page must be HTTPS (or localhost) — `crypto.subtle` is unavailable otherwise. Generate the pair once and keep it; changing it later invalidates every device subscription, and each device has to enable notifications again.
