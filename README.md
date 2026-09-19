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

## POC limitations

- Local JSON persistence rather than PostgreSQL
- Single-process server and no creator authentication
- CSS selector success matching currently supports element IDs and `data-testid`
- Evidence timeline instead of full DOM replay
- No public hosting, participant recruitment or AI-generated findings

These are deliberate boundaries. The POC validates the hardest product loop before cloud architecture and team administration are introduced.
