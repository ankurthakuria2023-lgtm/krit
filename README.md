# A Little Something 🌷 — GitHub Pages + Supabase

This is a static GitHub Pages adaptation of the original romantic site. The original flower/poem/compliment/game/dark-mode/contact sections are retained, with a private sign-in gate, synced messaging, photo/snaps, shared reminders, and optional web push.

## Architecture and important limits

- **GitHub Pages** hosts `index.html`, JS, CSS, the manifest, and service worker. It cannot run Flask or keep secrets.
- **Supabase Auth, Postgres + RLS, Realtime, and private Storage** handle the two accounts and shared data.
- **Supabase Edge Functions + VAPID** send push notifications. GitHub Actions can invoke the scheduled reminder function every five minutes (GitHub schedule timing is best-effort, not exact).
- Web push requires HTTPS and user permission. iOS/iPadOS web push requires a supported version and the website added to the Home Screen; browsers/platform settings can still affect delivery. Push is not guaranteed.
- This project intentionally does not include your Supabase project keys or VAPID private key. Never publish a Supabase `service_role` key or VAPID private key.

## 1. Create Supabase project and the two private accounts

1. Create a project at https://supabase.com/.
2. In **Authentication → Providers**, enable Email. For private access, keep public sign-ups disabled if your project settings allow it, and create/invite the two accounts yourself in **Authentication → Users**. Set strong, separate passwords.
3. Copy each user's UUID from the Auth Users screen. These are not the email addresses.
4. Open **SQL Editor**, run `supabase/schema.sql`, then uncomment and edit the final `insert into public.allowed_users` statement with both UUIDs. Run that insert separately. Only the two approved IDs should be inserted.
5. In **Project Settings → API**, copy the Project URL and the public anon/publishable key.
6. Edit `supabase-config.js` and replace `YOUR_PROJECT_REF`, `YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY`. The browser key is not a secret; the RLS rules are mandatory. Never use the service-role key here.
7. In **Database → Replication** or the publication settings, ensure `messages` and `reminders` are in `supabase_realtime` if the SQL publication statements were skipped due to existing membership.

## 2. Deploy the site to GitHub Pages

1. Create a GitHub repository. Upload the contents of this folder (not the containing folder) to the repository root. Commit `index.html`, `messenger.js`, `supabase-config.js`, `sw.js`, `manifest.webmanifest`, `icon.svg`, `.nojekyll`, `supabase/`, and `.github/`.
2. Create an empty `.nojekyll` file in the repository root (this project includes it).
3. In GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**; choose `main` and `/ (root)`, then Save.
4. Wait for the published URL. Open the HTTPS URL. For a project site, it usually looks like `https://YOURNAME.github.io/REPOSITORY/`.
5. Test both logins from separate browser profiles/devices. If you change config, commit and push again.

## 3. How the messaging works

- Log in with the first or second approved account; no sign-up form is exposed in the site.
- Messages and replies sync via Supabase Realtime. Reply buttons send a new message referencing the original.
- Photo upload accepts image files up to 10 MB. On phones, the picker may offer camera capture. Photos live in the private `private-snaps` bucket and are displayed with temporary signed URLs.
- Reminders are stored in Supabase and sync. The app does not require the website to stay open for scheduled notifications once the Edge Function and schedule are configured.

## 4. Configure web push notifications

### Generate VAPID keys

Use a trusted local environment with Node.js installed:

```bash
npx web-push generate-vapid-keys
```

Keep the **private** key secret. Put only the public key in `supabase-config.js` as `VAPID_PUBLIC_KEY`.

### Deploy Edge Functions

Install the Supabase CLI and log in, then from this repository root:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set VAPID_PUBLIC_KEY=YOUR_PUBLIC_KEY VAPID_PRIVATE_KEY=YOUR_PRIVATE_KEY VAPID_SUBJECT=mailto:YOUR_EMAIL
supabase functions deploy send-push
supabase functions deploy process-reminders --no-verify-jwt
```

`send-push` uses caller JWT validation. `process-reminders` disables Supabase JWT verification because it uses a separate high-entropy cron secret; the function itself checks `x-reminder-secret` before doing anything. Generate a secret, for example with `openssl rand -hex 32`, and set it:

```bash
supabase secrets set REMINDER_CRON_SECRET=YOUR_LONG_RANDOM_SECRET
```

In GitHub repository **Settings → Secrets and variables → Actions**, add:

- `SUPABASE_FUNCTIONS_URL` = `https://YOUR_PROJECT_REF.supabase.co/functions/v1`
- `REMINDER_CRON_SECRET` = the same secret configured in Supabase

Commit the workflow at `.github/workflows/reminders.yml`. GitHub Actions will invoke the reminder function approximately every five minutes. You can also use **Actions → Send due reminders → Run workflow** to test it.

### Enable on each device

1. Open the published HTTPS website and sign in.
2. Press **Enable notifications** and allow browser notifications.
3. On iPhone/iPad, add the site to the Home Screen first, open it from that icon, sign in, then enable notifications (supported iOS/iPadOS version required).
4. Send a test message to the other account. If push is configured, the receiver should get a notification even when the page is not open, subject to OS/browser permission and power/network settings.

## 5. Test checklist

- [ ] Wrong password does not sign in.
- [ ] An account not in `allowed_users` is signed out after login.
- [ ] Both approved users see the same messages and reminders.
- [ ] Send/reply from device A and confirm device B updates.
- [ ] Upload an image and confirm it displays to the other approved user.
- [ ] Enable push on device B, send from A, confirm notification.
- [ ] Add a reminder a few minutes in the future and check GitHub Actions/function logs after its due time.
- [ ] Confirm the site works at the GitHub Pages **HTTPS URL** (not `file://`).

## Troubleshooting

- **“Set up Supabase first”**: verify `supabase-config.js` and wait for the new GitHub Pages deployment.
- **Login rejected / not approved**: create the Auth user and add the correct UUID to `allowed_users`.
- **No real-time updates**: enable Realtime for `messages` and `reminders`; inspect browser console and Supabase logs.
- **Photos fail**: check Storage policies and ensure the private `private-snaps` bucket exists.
- **Push fails**: check the browser permission, HTTPS, service worker scope, VAPID public/private pair, Edge Function secrets and logs. Push subscription endpoints can expire.
- **Reminder not sent**: confirm GitHub Actions secrets and workflow permissions; inspect Actions logs and Supabase Edge Function logs.

## Security notes

- The browser only receives the public/anon key. RLS is what protects data.
- Do not add untrusted UUIDs to `allowed_users`; anyone added there is granted access to the shared private site.
- The schema intentionally grants no public sign-up flow and no public Storage access.
- The site uses signed photo URLs that expire after one hour. A recipient can still save/copy a photo while it is visible; no website can prevent screenshots.
- The sample design still includes the original contact details and romantic page content. Remove or edit those if you do not want them publicly visible in the repository. A static site cannot hide its HTML source from visitors; the login gate is visual, while Supabase data is protected by RLS. If the whole romantic page must be secret, we should move the content behind authenticated data or use a host that supports server-side access control.
