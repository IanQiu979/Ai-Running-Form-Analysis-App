<!--
  SOURCE OF TRUTH — this file is the text published at
  https://ianqiu979.github.io/Ai-Running-Form-Analysis-App/privacy-policy/ (GitHub Pages,
  built by `.github/workflows/privacy-policy-pages.yml` from this file on every push to `main`
  that touches it). Edit here, merge, and the page rebuilds; never edit a hosted copy.

  Analysis, not legal advice. Drafted from the engineering and product record of the app as
  built; counsel reviews this policy, the in-app consent mechanism, and the App Store privacy
  label answers before any public store submission (`docs/privacy-checklist-m7.md`).

  Attaching this URL to the App Store Connect record is Apple-gated and tracked in
  `docs/blocked-on-apple.md`, not here.
-->

# Pace Analysis AI — Privacy Policy

**Last updated: 2026-09-20**

Pace Analysis AI ("the app," "we," "us") is operated by **Ian Qiu**, a sole trader
established in **Thailand**, who is the data controller for everything described below. This
policy explains what we collect when you use the app, why, how long we keep it, who else sees
it, and how to get it deleted.

Pace Analysis AI is built and run by Ian Qiu, a **McMillan Running certified coach** (certified
May 2026). The form rubric every analysis applies — the four pillars, their metric ranges, and
the injury-risk flags — is his own coaching work; the AI applies that rubric to your frames.

---

## This is not medical advice

Pace Analysis AI analyzes a photo or video of your running form and returns scores and
feedback, including flags for movement patterns that research associates with elevated
injury risk. **It does not diagnose injuries or conditions, and it is not a substitute for
a doctor or a qualified sports physiotherapist.** If you have pain, swelling, or a
persistent problem, or before making a significant change to how you run, see a
professional. Never keep running through sharp or worsening pain to get an analysis.

---

## What we collect, and why

| Data | What it is | Why we collect it | Legal basis |
|---|---|---|---|
| Email address and auth identifiers | Your email, and an identifier from Google sign-in if you use it, plus your account ID | To create and secure your account, and to let you sign in | Contract (GDPR Art. 6(1)(b)) — necessary to provide the account you asked for |
| Extracted frames from your photo or video | Still images pulled from your submission, showing your body and possibly your face | To generate your form analysis | Contract (GDPR Art. 6(1)(b)) |
| Your analysis results | Scores, injury-risk flags, and posture descriptions for each analysis | To show you your results and let you revisit them in Past Analyses | Consent (GDPR Art. 6(1)(a)), plus explicit consent for special category health data (GDPR Art. 9(2)(a)) — see below |
| Usage details | Your subscription tier, how many analyses you've run, whether you submitted a photo or video, and timestamps | To enforce your plan's limits and keep your account working correctly | Contract (GDPR Art. 6(1)(b)) |
| Age range | Whether you told us you are 18 or older, or 13 to 17 — never your exact age — and, if you are 13 to 17, the record of your parent's or guardian's consent (see "Age" below) | To apply the right rules to your account and to be able to show that a minor's data is processed with consent | Legal obligation and explicit consent (GDPR Art. 6(1)(c), Art. 9(2)(a); Thai PDPA s.26) |

**A note on the video you record or upload:** your original, full-resolution video **never
leaves your device**. The app extracts a small number of still frames from it on your
phone, and only those extracted frames are uploaded and analyzed. We never receive or
store the video itself.

### Your results, and what you agree to

The frames themselves — plain images of you running — are not used to recognise or
identify anyone. We do not process them as biometric identification data.

The *results* are different. Scores, injury-risk flags, and posture descriptions are
information about your body and your health, and we treat them as health data under data
protection law (GDPR Article 9).

We ask you to agree once, when you create your account (or, for a Google sign-in, the first
time you use it). On that same page as the account terms, you must actively tick a statement
confirming that the photos and videos you upload are health-related data processed by AI
(Anthropic) to analyse your running form, and that any photo or video you upload or record —
now or later — shows only yourself or someone who has agreed to this analysis. This policy,
which names Anthropic and explains how your frames are stored, is linked from that page. The
app does not ask again before each upload; nothing is analysed for an account that has not
given this consent, and no analysis is created without it.

You can withdraw your consent at any time from the Consent row in Settings, by deleting your
analyses or your account, or by contacting us at the address below. Withdrawing stops any
further processing of your health data; it does not undo processing that already happened.

---

## Who we share it with

Our service providers are:

- **Anthropic** (maker of the Claude AI models) receives the extracted frames from your
  submission and generates your analysis from them — so both the frames and the resulting
  scores and injury-risk flags pass through Anthropic's systems. We use Anthropic's
  commercial API. Under its terms, your data is not used to train Anthropic's models. In
  the ordinary course, Anthropic deletes the frames and the generated results from its
  systems within about 30 days.
  **One exception you should know about:** if Anthropic's automated safety systems flag a
  request, Anthropic may retain the inputs and outputs for **up to two years**. That is
  outside our control and it continues to apply even after you delete the analysis in this
  app.
  We are pursuing a Zero Data Retention arrangement with Anthropic, which would stop your
  frames being stored on their systems at all. Even under that arrangement, the
  flagged-content exception above would still apply.
- **Supabase** hosts our database, authentication, and file storage (in the
  ap-southeast-2 / Sydney region). Supabase stores your account, your extracted frames,
  and your results on our behalf, under a data processing arrangement, and does not use
  your data for its own purposes.
- **Google** provides Sign in with Google, if you choose that sign-in method. Google acts
  as an identity provider for that flow only.
- **Have I Been Pwned** (operated by Superlative Enterprises, served via Cloudflare) is
  contacted when you create an account, to check whether the password you chose has appeared
  in a known data breach. **Your password never leaves your device.** We hash it on your
  device and send only the first five characters of that hash — a fragment shared by many
  thousands of different passwords, from which yours cannot be identified. HIBP and
  Cloudflare do see your IP address and the time of the request, as they would for any web
  request.
- **Apple** distributes the app to testers during our TestFlight beta.

We don't sell your data to anyone, and we don't use it for advertising. We do not run our
own analytics, advertising, or crash-reporting service. If you're using the app through
Apple's TestFlight, Apple provides us with crash logs and any feedback you choose to send —
that's Apple's service, governed by Apple's privacy policy, not ours. We don't track you
across other apps or websites, and nothing you do in this app is used to build an
advertising profile.

---

## International transfers

Your data crosses borders to reach the service providers listed above:

- **Anthropic** processes your frames and generates your results in the **United States**.
- **Supabase** stores your account, your frames, and your results in **Sydney,
  Australia**.

During our current TestFlight beta, the tester group is restricted to people outside the
EU/UK, so these transfers are not currently subject to GDPR's international-transfer
rules. If we ever admit EU/UK testers or users, we will put a recognised transfer
safeguard in place first — Standard Contractual Clauses (SCCs) under each processor's data
processing agreement — and name it here before that happens.

---

## Where your data lives, and for how long

- Your extracted frames are stored in a **private storage location that only your account
  can access** — there are no public links to them.
- Your frames and your analysis results are kept **until you delete that analysis, or
  until you delete your account** — whichever comes first. There is currently no separate
  automatic expiry beyond that.
- Deleting a single analysis removes its stored frames and its result immediately.
  Deleting your account removes everything: your account, every analysis, and every
  stored frame.
- Deleted data may persist briefly afterward in our **encrypted backups**, until the
  backup cycle catches up, and request metadata (not frame bytes or analysis results) may
  appear in **edge-function logs** for a short retention period.
- As described above, Anthropic's copy of your frames and results follows its own
  retention terms (ordinarily about 30 days, up to two years if flagged), independent of
  when you delete the analysis in the app.

---

## Your rights

Wherever you're located, we offer these controls to every user:

- **Access.** You can see your own analyses and results in the app's History screen.
- **Deletion.** You can delete a single analysis from the History screen, or delete your entire
  account and all of its data from the app's Settings screen.
- **Export.** If you'd like a copy of your data in a portable format, contact us (below)
  and we'll provide it. This is currently a manual, support-driven process rather than an
  automated in-app export.
- **Withdraw consent.** You can withdraw your consent to the processing of your health
  data at any time — see "Your results, and what you agree to" above.
- **Rectification.** If something we hold about you is inaccurate, you can ask us to
  correct it.
- **Restriction.** You can ask us to pause processing your data while a dispute about it
  is resolved.
- **Objection.** You can object to our processing of your data on grounds relating to your
  particular situation.
- **Complain to a regulator.** If you're in the EU or UK, you have the right to lodge a
  complaint with your local data protection supervisory authority at any time — you don't
  need to contact us first.

**However you reach us:** you can also ask us to delete your account and all its data, or
request a copy of everything we hold about you, by emailing us at the address below; we'll
action it within 30 days.

If you are in the EU/UK, these map to your GDPR rights of access (Art. 15), rectification
(Art. 16), erasure (Art. 17), restriction (Art. 18), portability (Art. 20), objection
(Art. 21), withdrawal of consent (Art. 7(3)), and to lodge a complaint with a supervisory
authority (Art. 13(2)(d)). If you are in California or another U.S. state with a
comparable law, these map to your rights to know, delete, correct, and obtain a copy of
your personal information.

---

## Age

You must be **13 or older** to use Pace Analysis AI. Creating an account asks which age range you
are in — 18 or older, or 13 to 17 — and does not offer an option for anyone younger; we do not
knowingly hold an account for anyone under 13, and if we learn that we do, we delete it.

If you are **13 to 17**, you may use the app **only with the consent of a parent or guardian**,
who agrees to this policy on your behalf. Before an account in that range can be created, the app
requires an explicit checkbox affirming that a parent or guardian has read this policy and agrees
to it on the runner's behalf, and we record that consent — the time it was given and which
version of this policy it covered — as a server-side event. An account created with Google
sign-in is asked the same question the first time it is used. This recorded consent is our stated
legal basis for processing a minor's data under GDPR Article 9(2)(a) and Thai PDPA section 26. If
you are a parent or guardian and believe your child is using the app without your consent,
contact us at the address below and we will delete the account. Deleting an account deletes its
consent record with it.

## Other people in your media

Pace Analysis AI is intended for the account holder's own running form. If your photo or video
includes another person — a friend, a coached athlete, or a minor — you're responsible for having
their (or their parent's/guardian's, for a minor) permission before submitting it.

---

## Changes to this policy

If we materially change what we collect or how we use it, we'll update this page and the
"Last updated" date above. If we materially change how we use your health data, we'll ask
for your consent again before the change applies to you.

---

## Contact

Questions about this policy or your data, or to request a deletion or export outside the
in-app tools: **i78979848@gmail.com**
