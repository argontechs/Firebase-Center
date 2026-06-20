# Firebase Center — Product Context

**Register:** product (an internal admin/back-office tool — design serves the work, not the brand).

## What it is
A self-hosted back-office for one company's team to manage **push notifications** across many of their own **Sites** (apps), through two providers: Firebase Cloud Messaging (FCM) and Huawei Push Kit. It centralizes encrypted provider credentials, a managed audience of device tokens, and a unified compose-and-send pipeline, plus a programmatic send API.

## Users
The owner's small operations team. Logged-in operators who: onboard Sites & Apps, paste/import provider credentials, import device tokens, issue API keys, compose and fire campaigns, and watch delivery results. Not end-customers; not a public SaaS.

## Tone & strategic principles
- **Trustworthy, calm, utilitarian.** This handles secrets and fires real pushes to real people. It should feel like a serious control panel, not a flashy SaaS landing.
- **Legibility over decoration.** Dense, scannable lists; obvious primary actions; unmistakable danger actions (revoke, delete, rotate).
- **Secrets are sacred.** Write-only credential fields, "shown once" keys, clear status (ready / not-ready, active / invalid / revoked).
- **Honest states.** Empty states, in-flight vs done campaigns, failed/gave-up deliveries are all visible and distinct.

## Scene sentence (drives theme)
An operator at a desk during the workday, scanning which Sites are ready to send and firing a campaign — focused, unhurried, in office light. → light, warm-neutral, low-drama.

## Anti-references (do NOT look like)
- Firebase-amber / Google-rainbow brand chrome.
- Generic "messaging-blue" SaaS dashboards with hero-metric cards and identical card grids.
- Neon-on-black "developer tool" cliché.
