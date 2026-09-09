# Connecting Classroom Copier to your real Google Classroom

This is the checklist for switching Classroom Copier from its practice mode
(fake accounts, fake courses) to your actual Google Classroom.

**Who this is for:** you. Not a developer. There is nothing here you type into a
black terminal window, and no step needs you to understand what any of it means
underneath. Where a technical word is unavoidable, it gets a plain-English
explanation the first time it appears.

**Time:** about 45 minutes for Parts 1–4 the first time. You can stop between
parts and come back — nothing expires while you are away, except one thing that
is called out where it happens.

**This file replaces `Connecting-To-Live-Google.docx`** as the version to trust.
That older Word file is left in place so nothing breaks, but it is no longer
kept up to date.

Each step has two halves: **do this**, and **you'll know it worked when**. If the
second half does not happen, stop there and read the troubleshooting note right
below it rather than pushing on — almost every hard problem in this process comes
from carrying a small mistake forward three steps.

---

## Part 1 — Set up your Google project

A "Google Cloud project" is just a container Google makes you create before it
will let an app talk to your Classroom. You only ever make one.

### ☐ 1.1 Create the project

**Do this:** Go to <https://console.cloud.google.com/>. Sign in with the SAME
Google account you use for Google Classroom. At the very top of the page there
is a project dropdown — click it, then **New Project**. Name it
`Classroom Copier`. Click **Create**.

**You'll know it worked when:** the dropdown at the top of the page now reads
"Classroom Copier" instead of "Select a project".

> **⚠️ The single most important thing on this page.** Everything from here on
> must happen inside **this same project**. Google's console remembers whichever
> project you last looked at, and it is genuinely easy to set half of this up in
> one project and half in another — at which point sign-in fails with an error
> message that does not mention projects at all. Before every step in Parts 1 and
> 2, glance at that dropdown and confirm it still says "Classroom Copier."

### ☐ 1.2 Turn on the Classroom connection

**Do this:** In the search box at the top, type `Google Classroom API` and open
the result. Click **Enable**.

**You'll know it worked when:** the blue "Enable" button is replaced by a page
with "API Enabled" and a **Manage** button.

### ☐ 1.3 Turn on the Drive connection

**Do this:** Search for `Google Drive API` the same way. Click **Enable**.

**You'll know it worked when:** same as above — the button changes to "Manage".

> Classroom Copier needs Drive as well as Classroom because assignments carry
> attachments, and copying an attachment is a Drive operation.

### ☐ 1.4 Fill in the consent screen

This is the page your teachers will see when they sign in — the one that says
"Classroom Copier wants to access your Google Account."

**Do this:** In the left menu, find **APIs & Services → OAuth consent screen**.
Choose **External** and click Create. Fill in:

- **App name:** `Classroom Copier`
- **User support email:** your email address
- **Developer contact information:** your email address again

Click **Save and Continue** through the remaining pages. You do not need to add
scopes by hand here — the app requests what it needs when someone signs in.

**You'll know it worked when:** the OAuth consent screen page shows "Publishing
status: **Testing**" and your app name.

### ☐ 1.5 Add everyone who will sign in, as a test user

**This step must happen before anyone tries to sign in.** Do not skip ahead.

While your app's publishing status is "Testing", Google will only let people you
have explicitly listed sign in. Everyone else is stopped by Google, on Google's
own page, before they ever reach Classroom Copier — which means the app cannot
show them a helpful message, because it never hears from them at all. They just
see a Google error.

**Do this:** On the OAuth consent screen page, find the **Test users** section
and click **+ Add users**. Add:

- your own Google Classroom address;
- **and the address of anyone else who will sign in during testing** — a
  co-teacher, a curriculum lead, an aide. Not just you. If a colleague is going
  to click the link even once, their address goes on this list.

**You'll know it worked when:** every address you expect to use appears in the
Test users list on that page.

> **Two limits worth knowing now, so neither surprises you later:**
>
> - The test-user list holds **100 people**. That is a hard Google limit, not a
>   setting. It is far more than you need for testing, but it is not a way to
>   roll the app out to a whole district.
> - In Testing mode, **everyone has to sign in again about once a week.** Google
>   expires the connection roughly every seven days. This is completely normal
>   and is not a sign that anything has broken. Classroom Copier is built for it:
>   if it happens partway through a copy, the app pauses, asks you to reconnect,
>   and then picks up exactly where it left off without copying anything twice.

---

## Part 2 — Tell Google where your app lives

### ☐ 2.1 Create the sign-in credentials

**Do this:** Go to **APIs & Services → Credentials**. Click **+ Create
Credentials** and choose **OAuth client ID**. For "Application type", choose
**Web application**. Name it `Classroom Copier Web`.

Do not click Create yet — there are two boxes to fill in first, in the next two
steps.

**You'll know it worked when:** you can see two boxes further down the form,
labelled "Authorised JavaScript origins" and "Authorised redirect URIs".

### ☐ 2.2 Fill in the two web addresses

Two different boxes, two different addresses. They are not interchangeable.

- **Authorised JavaScript origins** — the address teachers type in to reach the
  app. Add: `https://classroom-copier.onrender.com`
- **Authorised redirect URIs** — the address Google should send people back to
  once they have approved. Add:
  `https://classroom-copier-api.onrender.com/api/auth/callback`

(If your app lives at different addresses than these, use yours — but keep the
same shape: the second one always ends in `/api/auth/callback`.)

Now click **Create**.

**You'll know it worked when:** a box pops up showing **Your Client ID** and
**Your Client Secret**. Copy both somewhere safe right now — the secret is
easier to copy now than to find again later.

> **⚠️ The address Google sends people back to must match character for
> character.** `http` instead of `https`, a capital letter, or one extra `/` on
> the end all count as a different address. When it does not match, Google
> refuses with "redirect_uri_mismatch" and never sends anyone back to the app. If
> you see that error, come back to this step and compare the two strings
> character by character rather than by eye — it is nearly always a trailing
> slash.

---

## Part 3 — Set up your app's settings

This part happens on Render, where the app is hosted, not on Google.

Render calls these "environment variables". They are just named settings the app
reads when it starts up.

### ☐ 3.1 Create the database

Classroom Copier keeps its records in a database. The practice-mode setting uses
a simple file, which is fine on your own computer and **not** fine on Render:
Render replaces the app's disk on every restart, and the file would vanish along
with every record of what had been copied. The backend refuses to start in this
mode for exactly that reason, so this step is not optional.

**Do this:** In the Render dashboard, click **New +** → **Postgres**. Name it
`classroom-copier-db`, pick the free plan, and click Create. Wait for its status
to become "Available". Then open it and copy the value labelled **Internal
Database URL**.

**You'll know it worked when:** the database's status reads "Available" and you
have a long address starting with `postgres://` on your clipboard.

### ☐ 3.2 Fill in the backend settings

**Do this:** Open your **backend** service on Render (the one whose name ends in
`-api`). Go to **Environment**, and add each of these:

| Setting name | What to put |
|---|---|
| `DATABASE_URL` | the Internal Database URL you copied in 3.1 |
| `DATABASE_PROVIDER` | `postgresql` |
| `GOOGLE_PROVIDER_MODE` | `google` |
| `GOOGLE_CLIENT_ID` | the Client ID from step 2.2 |
| `GOOGLE_CLIENT_SECRET` | the Client Secret from step 2.2 |
| `GOOGLE_REDIRECT_URI` | the redirect address from step 2.2, exactly as you entered it there |
| `FRONTEND_ORIGIN` | `https://classroom-copier.onrender.com` |
| `CORS_ORIGINS` | `https://classroom-copier.onrender.com` |
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | see 3.3 |
| `TOKEN_ENCRYPTION_KEY` | see 3.3 |

**You'll know it worked when:** all eleven names appear in the Environment list.

> **`CORS_ORIGINS` also affects things that are not sign-in.** It controls which
> web addresses the browser will let talk to the backend. If it is wrong, most of
> the app appears to work and specific actions — signing out is the usual one —
> fail with nothing on screen to explain why. If you ever see a button that does
> nothing at all, this setting is the first place to look.

### ☐ 3.3 Generate the two secret keys

Two of the settings above are secret keys the app generates rather than you
inventing. They must be different from each other: one signs the "you are
logged in" cookie, and the other encrypts each teacher's Google connection. If
they were the same, one leak would expose both.

**Do this, without a terminal:** Render can make these for you. In the
Environment page, when adding `SESSION_SECRET`, click the **Generate** button
Render offers next to the value box. Do the same for `TOKEN_ENCRYPTION_KEY`.

*If your Render plan does not show a Generate button*, use any "random base64
string" generator and ask it for **32 bytes**. `TOKEN_ENCRYPTION_KEY` in
particular must be exactly 32 bytes of base64 — the app checks, and refuses to
start on anything shorter rather than protecting tokens with a weak key. (A
developer would run `openssl rand -base64 32`; you do not have to.)

**You'll know it worked when:** both values are filled in, both look like
roughly 44 characters of jumbled letters, numbers, `+`, `/` and `=`, and the two
are **not** identical to each other.

### ☐ 3.4 Fill in the frontend setting

**Do this:** Open your **frontend** service on Render (the one WITHOUT `-api` in
the name). Go to **Environment** and add:

| Setting name | What to put |
|---|---|
| `VITE_API_BASE_URL` | `https://classroom-copier-api.onrender.com` |

**You'll know it worked when:** the setting appears in the list.

> **This one needs a rebuild, not a restart.** Frontend settings that start with
> `VITE_` are baked in when the site is built, so restarting the service leaves
> the old value in place. After saving, use **Manual Deploy → Deploy latest
> commit** on the frontend service. A restart alone will look like the setting
> "didn't take".

### ☐ 3.5 Restart the backend and check it is alive

**Do this:** On the **backend** service, click **Manual Deploy → Deploy latest
commit**. Wait for the deploy to finish. Then visit, in your browser:

`https://classroom-copier-api.onrender.com/api/health`

**You'll know it worked when:** you see a short line of text containing
`"status":"ok"`.

> **The health address is `/api/health`, not `/health`.** Without the `/api` you
> get a "Cannot GET" error that looks exactly like the backend being down when
> it is actually running perfectly.
>
> **If the first load is slow, that is normal.** Render puts free services to
> sleep when nobody is using them, and waking one up takes up to about a minute.
> The app shows a "Waking up server…" message when this happens.

---

## Part 4 — Try it

### ☐ 4.1 Sign in for real

**Do this:** Go to `https://classroom-copier.onrender.com`. Click **Sign in with
Google**. Choose your Classroom account, and approve the permissions Google
asks about.

**You'll know it worked when:** you land back in Classroom Copier and see your
own name and email in the bar at the top, followed by your real course list.

**What Google will ask you to approve.** Before you land back in the app, Google
shows a list of permissions. It is longer than most people expect, so here is
what is on it and why, in advance:

- **See your name, email address and profile picture** — that is what the app
  shows in the bar at the top so you can tell which account you are working as.
- **See your Google Classroom classes** — to show you your course list.
- **Manage your coursework and materials** — to create the copied assignments
  and materials in the destination course. Everything it creates arrives as an
  unpublished draft.
- **Manage your class topics** — copied items keep the topic they were filed
  under, which means creating that topic in the destination if it isn't there.
- **See information about your Google Drive files** — Google will tell you this
  app can see information about **all** your Drive files. It reads file names
  and sharing settings to check whether an attachment will copy; it never opens
  or downloads their contents.
- **See, edit, create and delete only the Drive files you use with this app** —
  for the "Copy to My Drive" button, which makes your own copy of an attachment
  you cannot otherwise reuse. It applies only to files this app makes.

Approve all of them. The app needs each one to finish a copy, and leaving any
unticked causes the problem described in step 4.2 below.

> **A few things that look like problems and are not:**
>
> - **"This app isn't verified."** Expected while your app is in Testing mode.
>   Click **Advanced**, then **Go to Classroom Copier (unsafe)**. It is your own
>   app; the warning is about Google not having reviewed it, not about danger.
> - **An error mentioning `/api/auth/me` in the browser's developer tools,
>   before you sign in.** Completely normal. That is the app asking "is anyone
>   signed in?" and correctly being told "no". It disappears once you sign in.
> - **"Access blocked" / "has not completed the Google verification process"
>   with no way past it.** The account you are using is not on the test-user
>   list. Go back to step 1.5 and add it. This is the most common failure at
>   this step, and it always looks worse than it is.

### ☐ 4.2 The real test — copy something, then copy it again

This is the checkpoint that actually tells you everything is working. Please do
both halves.

**Do this:** Pick two of your own courses — ideally a real one with a few items,
and an empty one you do not mind writing into. Copy **one item** from the first
into the second. Then run **the exact same copy a second time.**

**You'll know it worked when:**

1. after the first copy, the item is sitting in the destination course **as a
   draft** (not published to students); and
2. the second copy does **not** create a duplicate. It tells you the item is
   already there and skips it, and the summary shows it under "already in
   course" rather than "copied".

> **If nearly every attachment shows as unavailable** — greyed out, or flagged
> as missing or locked, on items you know are fine — the permissions from step
> 4.1 were not all granted. Sign out of Classroom Copier, sign in again, and
> approve **every** item on Google's list, including the one about seeing
> information about your Drive files. Nothing has happened to the attachments
> themselves; the app simply cannot see them well enough to check.

If both halves happen, the connection is correct end to end: Google is
authorising you, the app is reading your real courses, it is writing to the real
destination, and its duplicate protection is on.

---

## ☐ If something doesn't work

Nothing here is a dead end, and nothing you do at this stage can damage a real
course — everything Classroom Copier writes lands as an unpublished draft that
you can delete.

If a step's "you'll know it worked when" does not happen and the troubleshooting
note next to it does not fix it, write down these four things and send them on:

1. **Which part and which step number** you were on (e.g. "Part 3, step 3.5").
2. **What you did** — the button you clicked or the value you entered.
3. **What you saw instead**, word for word if there was an error message. A
   screenshot of the whole browser window is better than a retyped summary.
4. **Which account** you were signed in as, and whether that address is on the
   test-user list from step 1.5.

Anything found this way comes back as a fix in a follow-up pass. You do not need
to work around it yourself.
