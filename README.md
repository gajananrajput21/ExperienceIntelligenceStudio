# Experience Intelligence Studio

Working proof of concept for turning a runnable HTML prototype into a measurable, task-based UX study.

## What works

- Upload a standalone HTML file or a ZIP containing `index.html`, CSS, JavaScript and local assets
- Validate and extract the prototype with path-traversal protection
- Run the prototype inside a sandboxed participant frame
- Create a task with a CSS-selector success condition
- Publish and copy a participant test link
- Set a study recruitment target (50 participants by default) with automatic link closure and progress tracking
- Capture clicks, navigation, forms, masked input metadata and runtime errors
- Let researchers select a measurement plan for each study, including task success rate, time, clicks, path efficiency, misclicks, hesitation, ease and confidence
- Calculate and display only the metrics selected for that study
- Interpret performance metrics with Excellent, Good, Moderate and Needs improvement benchmarks
- Collect study-specific ratings, comments and an optional custom post-task question
- Watch a privacy-safe, video-like interaction replay with click and dwell maps, or review the chronological evidence timeline
- Filter participant sessions by outcome and delete individual records with their associated replay and feedback
- Edit or permanently delete projects and studies with scoped cascade cleanup
- Persist study data and uploaded prototype archives in PostgreSQL when deployed
- Invite UX researchers and managers into a private team workspace
- Set teammate workspace access for 30–180 days, review expiry dates and renew access when needed
- Keep researcher projects separated while Owners and Viewers can review workspace-wide results
- Let participants complete public studies without creating an account
- Use a responsive light/deep-blue liquid-glass interface across researcher, manager and participant experiences

## Team accounts and roles

The production app opens with a sign-in screen. The original `founder` account becomes the workspace Owner and continues to use the `ADMIN_PASSWORD` configured in Render.

- **Owner:** sees all workspace work, manages members, creates studies and reviews results.
- **Researcher:** creates projects and sees their own work and evidence.
- **Viewer / manager:** sees workspace-wide projects and results but cannot create or modify research.
- **Participant:** uses a public study link with no account.

From **Team**, the Owner enters a teammate's email, chooses a role, creates an invitation, and privately shares the generated seven-day link. The teammate sets their name and password when accepting. Removing a member signs them out immediately but preserves their projects; the Owner can reinvite the same email later.

## Run locally

Requirements: Node.js 20+ and the `unzip` command (needed for ZIP uploads).

```bash
npm start
```

Open `http://localhost:4173`.

Choose **Load demo** for the fastest end-to-end walkthrough. When creating the demo study, keep the default success selector `#open-evaluation`.

## Prototype upload formats

A standalone `.html` or `.htm` ideation output can be uploaded directly. It is stored and run as the prototype's `index.html` automatically.

Use a ZIP when the prototype depends on separate CSS, JavaScript, image, font or other local asset files:

```text
prototype.zip
├── index.html
├── styles.css
├── app.js
└── assets/
```

One optional top-level folder is also supported. Prototype assets should be local. Outbound network access is blocked by the prototype Content Security Policy.

## Deploy a public pilot on Render

The included `render.yaml` creates both the Node.js web service and a PostgreSQL database in the Singapore region.

1. Push this repository to GitHub.
2. In Render, choose **New > Blueprint**.
3. Connect the `ExperienceIntelligenceStudio` repository.
4. When prompted for `ADMIN_PASSWORD`, enter a strong password you will remember.
5. Review the two resources and choose **Apply**.
6. When deployment finishes, open the generated `onrender.com` URL, sign in with username `founder`, and choose **Load demo**.

Render supplies `DATABASE_URL` automatically from the Blueprint. Uploaded ZIP files are stored in PostgreSQL and restored into a temporary runtime cache when needed. Locally, the app continues to use `data/store.json` and `data/archives/` with no database setup.

The creator workspace and results APIs use account sessions and server-enforced roles. Participant study links remain public. The `/api/health` endpoint reports whether the app and its configured storage are reachable.

> **Free-tier note:** Render's free web service sleeps after 15 minutes without traffic, so the first load can take about a minute. A free Render PostgreSQL database expires after 30 days and has no backups. Use the free plan only for prototype validation, and upgrade the database before collecting any data you need to retain.

## POC limitations

- No self-service forgotten-password email flow; an Owner can remove and reinvite a teammate while preserving their projects
- One organization workspace rather than multiple organizations per account
- Session replay reconstructs masked interaction events; it is not a camera, microphone or full screen recording
- Misclick, hesitation, backtracking and dwell measurements are system-inferred behavioral signals and require researcher interpretation
- Pilot-scale JSONB state model rather than normalized analytics tables
- CSS selector success matching currently supports element IDs and `data-testid`
- Evidence timeline instead of full DOM replay
- No participant recruitment or AI-generated findings

These are deliberate boundaries. The POC validates the hardest product loop before cloud architecture and team administration are introduced.
