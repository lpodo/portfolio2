# Deploy your own Portfolio Terminal 2 worker

Portfolio Terminal 2 is only the client half: it holds your portfolios and draws the interface, but every price, chart and lookup comes from a server, and that server is the worker. Without one the app has nothing to show — so each user runs their own copy, and this guide walks through creating it.

The worker (`worker.js`) is Portfolio Terminal 2's price backend and (optionally) the proxy for cloud sync via Cloudflare KV, plus scheduled alert checks with push notifications.

## Prerequisites

- A [Cloudflare](https://cloudflare.com) account. The free plan is enough.
- The `worker.js` file from this repository.

## Deploy the worker

1. **Create the Worker.** Cloudflare dashboard → **Workers & Pages** → **Create** → **Create Worker**. Enter a name (this becomes part of the URL: `<name>.<subdomain>.workers.dev`). Click **Deploy** to create a stub.
2. **Paste the code.** Open the new worker → **Edit code**. Delete the stub content, paste `worker.js`, click **Deploy**.
3. **Set the API token.** Worker page → **Settings** → **Variables and Secrets** → **Add**. Choose type **Secret**, so the value can't be read back from the dashboard. Name: `API_TOKEN`. Value: any long random string. Save.
4. **Wire the frontend.** In Portfolio Terminal 2, open Settings → **PROVIDER** and enter the worker URL and the same token.

## Attach Cloudflare KV (optional)

Needed for the **Cloudflare KV** cloud sync backend, and required for server-side alert checks. If you plan to use JSONBin and don't want push notifications, skip this.

1. **Create a KV namespace.** Dashboard → **Workers & Pages** → **KV** → **Create a namespace**. Give it any name (e.g. `PT2`).
2. **Bind it to the worker.** Worker page → **Settings** → **Bindings** → **Add** → **KV Namespace**. Set **Variable name** to exactly `PORTFOLIO_KV` — the worker looks this binding up by name; anything else won't work. Select the namespace you just created. Save.
3. **Wire the frontend.** In Portfolio Terminal 2, Settings → **CLOUD STORAGE** → select **Cloudflare KV** → enter any unique **KV Key** (e.g. your username). This key identifies your data slot within the namespace.
4. **Optional: encrypt.** In Portfolio Terminal 2, Settings → **ENC KEY**, set any password. Portfolio data is then AES-GCM encrypted client-side before it reaches KV — the namespace stores only an opaque blob. The same password must be entered on every device that syncs; if you lose it, the cloud data can't be recovered.

## Enable alert checks and push notifications (optional)

Lets the worker check your alerts on a schedule and notify you while the app is closed. Requires the KV steps above — alerts and device subscriptions live in the same namespace, under a separate key.

1. **Generate a VAPID key pair.** Run `npx web-push generate-vapid-keys`. It prints a public and a private key. No Node available? See the [appendix](#appendix-generating-vapid-keys-without-npx) for a browser-console alternative.
2. **Add them to the worker.** Worker page → **Settings** → **Variables and Secrets**. Add `VAPID_PUBLIC_KEY` as a plaintext **Variable** — it's handed to every client anyway via `/api/push/key`. Add `VAPID_PRIVATE_KEY` as a **Secret**. Optionally add `VAPID_SUBJECT` as `mailto:you@example.com` — push services expect a contact address, and the worker falls back to a placeholder without it.
3. **Add a cron trigger.** Worker page → **Settings** → **Triggers** → **Cron Triggers** → **Add**. Use `*/5 * * * *`. The cron only wakes the worker; your in-app settings decide which checks actually run, so a frequent trigger is harmless and helps large watchlists finish a round sooner.
4. **Wire the frontend.** In Portfolio Terminal 2, Settings → **PUSH NOTIFICATIONS** → enable. Grant the browser's notification permission when asked, then set the check interval, the daily time window, and optionally the movers digest. Repeat on every device you want notified.

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

Copy the two values into the Secrets. Sanity check: the public key is 87 characters, the private key 43.

The page must be HTTPS (or localhost) — `crypto.subtle` is unavailable otherwise. Generate the pair once and keep it; changing it later invalidates every device subscription, and each device has to enable notifications again.
