# Deploy your own Portfolio Terminal 2 worker

The worker (`worker.js`) is Portfolio Terminal 2's price backend and (optionally) the proxy for cloud sync via Cloudflare KV. This guide walks through deploying your own copy.

## Prerequisites

- A [Cloudflare](https://cloudflare.com) account. The free plan is enough.
- The `worker.js` file from this repository.

## Deploy the worker

1. **Create the Worker.** Cloudflare dashboard → **Workers & Pages** → **Create** → **Create Worker**. Enter a name (this becomes part of the URL: `<name>.<subdomain>.workers.dev`). Click **Deploy** to create a stub.
2. **Paste the code.** Open the new worker → **Edit code**. Delete the stub content, paste `worker.js`, click **Deploy**.
3. **Set the API token.** Worker page → **Settings** → **Variables and Secrets** → **Add**. Choose type **Secret** (not Variable — Variables reset between deployments). Name: `API_TOKEN`. Value: any long random string. Save.
4. **Wire the frontend.** In Portfolio Terminal 2, open Settings → **PROVIDER** and enter the worker URL and the same token.

## Attach Cloudflare KV (optional)

Needed only if you want to use the **Cloudflare KV** cloud sync backend. If you plan to use JSONBin, or don't need cross-device sync, skip this.

1. **Create a KV namespace.** Dashboard → **Workers & Pages** → **KV** → **Create a namespace**. Give it any name (e.g. `PT2`).
2. **Bind it to the worker.** Worker page → **Settings** → **Bindings** → **Add** → **KV Namespace**. Set **Variable name** to exactly `PT2_KV` — the worker looks this binding up by name; anything else won't work. Select the namespace you just created. Save.
3. **Wire the frontend.** In Portfolio Terminal 2, Settings → **CLOUD STORAGE** → select **Cloudflare KV** → enter any unique **KV Key** (e.g. your username). This key identifies your data slot within the namespace.
4. **Optional: encrypt.** In Portfolio Terminal 2, Settings → **ENC KEY**, set any password. Portfolio data is then AES-GCM encrypted client-side before it reaches KV — the namespace stores only an opaque blob. The same password must be entered on every device that syncs; if you lose it, the cloud data can't be recovered.

## Verify

In Portfolio Terminal 2, click **↑ OVERWRITE CLOUD**. If everything is wired correctly, the sync succeeds without errors. The worker is now serving your prices and (if configured) your sync.
