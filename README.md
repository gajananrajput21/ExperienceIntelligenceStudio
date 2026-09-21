# Experience Intelligence Studio

Working proof of concept for turning a runnable HTML prototype into a measurable, task-based UX study.

## What works

- Upload a ZIP containing `index.html`, CSS, JavaScript and local assets
- Validate and extract the prototype with path-traversal protection
- Run the prototype inside a sandboxed participant frame
- Create a task with a CSS-selector success condition
- Publish and copy a participant test link
- Capture clicks, navigation, forms, masked input metadata and runtime errors
- Calculate task success and completion time
- Collect task ease, confidence and optional comments
- Review participant-level evidence timelines
- Persist study data and uploaded prototype archives in PostgreSQL when deployed

## Run locally

Requirements: Node.js 20+ and the `unzip` command.

```bash
npm start
```

Open `http://localhost:4173`.

Choose **Load demo** for the fastest end-to-end walkthrough. When creating the demo study, keep the default success selector `#open-evaluation`.

## Prototype ZIP format

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

The creator workspace and results APIs use password protection. Participant study links remain public. The `/api/health` endpoint reports whether the app and its configured storage are reachable.

> **Free-tier note:** Render's free web service sleeps after 15 minutes without traffic, so the first load can take about a minute. A free Render PostgreSQL database expires after 30 days and has no backups. Use the free plan only for prototype validation, and upgrade the database before collecting any data you need to retain.

## POC limitations

- Single creator password rather than team accounts and roles
- Pilot-scale JSONB state model rather than normalized analytics tables
- CSS selector success matching currently supports element IDs and `data-testid`
- Evidence timeline instead of full DOM replay
- No participant recruitment or AI-generated findings

These are deliberate boundaries. The POC validates the hardest product loop before cloud architecture and team administration are introduced.
