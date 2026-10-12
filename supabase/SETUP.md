# Heavenly Life Center: Supabase setup

The public site and admin dashboard use the same Supabase project for event
records, poster images, admin accounts, live event updates, and phone
notifications. Until this setup is complete, the public site continues to show
the regular weekly services, but administrator changes cannot be published.

## 1. Create the project and database

1. Create a Supabase project for the church.
2. Open **SQL Editor**, then run
   [`migrations/20261009_shared_church_events.sql`](./migrations/20261009_shared_church_events.sql).
3. Run [`migrations/20261012_security_hardening.sql`](./migrations/20261012_security_hardening.sql)
   to restrict execution of internal trigger functions.
4. Run [`migrations/20261012_invite_keerthi_admin.sql`](./migrations/20261012_invite_keerthi_admin.sql)
   in SQL Editor to allow `keerthi@sowibo.com` to create the first admin account.
5. In **Authentication → Providers**, enable Email sign-in and decide whether
   to require email confirmation. **Keep email confirmation enabled** so only
   the invited email owner can receive administrator access.
6. In **Authentication → URL Configuration**, set the site URL to the deployed
   HTTPS website and add `https://YOUR_DOMAIN/admin.html` to the redirect URLs.
7. In **Authentication → Security and Protection**, enable leaked-password
   protection and configure a strong minimum password length. Keep Supabase
   Auth rate limits enabled. Enable admin multi-factor authentication where
   available; before making it mandatory, update the sign-in flow to complete
   MFA challenges and enforce the required assurance level in database policies.

## 2. Connect the website

In **Project Settings → API**, copy the project URL and its public
publishable/anon key into [`../supabase-config.js`](../supabase-config.js):

```js
window.SUPABASE_CONFIG = {
    url: "https://YOUR_PROJECT_ID.supabase.co",
    anonKey: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY",
    vapidPublicKey: "YOUR_VAPID_PUBLIC_KEY"
};
```

The publishable/anon key is intended to be visible in a website. Database row
policies and storage policies enforce access. **Never put the Supabase
service-role key or VAPID private key in this file.**

## 3. Deploy securely

Deploy the site only over HTTPS and include the root [`../_headers`](../_headers)
file if your static host supports Netlify/Cloudflare-style headers. If your
host uses a different configuration, set the equivalent response headers
there, especially Content-Security-Policy, X-Content-Type-Options,
Referrer-Policy, X-Frame-Options, Permissions-Policy, and Strict-Transport-Security.
The HTML also supplies a Content Security Policy, but framing protection and
the other response headers require host support.

## 4. Create the first admin

1. Deploy the site to its HTTPS address.
2. Open `/admin.html`, select **Create an invited admin account**, and register
   with `keerthi@sowibo.com`.
3. Choose a password in the signup form. Supabase Auth stores the password
   securely; the allowlist stores the approved email and links its user ID
   after email confirmation.
4. If email confirmation is enabled, confirm the email and sign in.
5. Use **Admin signup settings** in the dashboard to allow more admin email
   addresses. Each invited person creates their own password from the signup
   form; allowing an email does not send an invitation email.

The homepage has no link to the admin dashboard; administrators open
`/admin.html` directly.

## 5. Enable phone push notifications

Push notifications need HTTPS, a service worker, and VAPID keys. Generate a VAPID public/private key pair with the
[`web-push` command-line tool](https://www.npmjs.com/package/web-push)
(`npx --yes web-push generate-vapid-keys`), then:

1. Put the **public** VAPID key in `vapidPublicKey` in
   [`../supabase-config.js`](../supabase-config.js).
2. Install the [Supabase CLI](https://supabase.com/docs/guides/cli), sign in,
   and link it to this project from the website folder.
3. Set the push secrets and deploy the Edge Function (PowerShell example):

   ```powershell
   supabase secrets set SITE_URL="https://YOUR_DOMAIN" VAPID_PUBLIC_KEY="YOUR_PUBLIC_KEY" VAPID_PRIVATE_KEY="YOUR_PRIVATE_KEY" VAPID_SUBJECT="mailto:YOUR_CONTACT_EMAIL"
   supabase functions deploy event-push --no-verify-jwt
   ```

   Use the site's origin (scheme and host only) for `SITE_URL`. Keep the private
   VAPID key only in Supabase secrets; do not commit it or place it in the
   website files. The function accepts public subscribe/unsubscribe requests,
   but verifies the signed-in admin and database admin role before sending
   pushes; keep that authorization check in place.
4. Visitors choose **Enable phone notifications** on the Events section and
   approve the browser prompt. On iPhone/iPad, they must first add the site to
   their Home Screen and open that installed app. The site also shows in-page
   updates while open.

The Supabase migration creates a public poster bucket with image-only uploads
limited to 10 MB. Only approved admins can upload, replace, or delete posters.
