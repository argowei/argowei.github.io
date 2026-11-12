# Argowei demo

This repository hosts the static, interactive demo of [Argowei](https://github.com/argowei/argowei). Its `frontend/` is a snapshot of the product's Angular dashboard at [commit `b8f34ee`](https://github.com/argowei/argowei/commit/b8f34ee6ecea124a807e9554b967e6c844f08162), with a browser-only API simulator.

The demo uses only synthetic devices, documentation IP addresses (`192.0.2.0/24`) and locally administered MAC addresses. Scans return simulated results immediately; schedules can be edited but never execute. The static schedule preview supports daily expressions in UTC. Any credentials sign in. Changes stay in the current browser tab and disappear on reload. No API server or network scanner is contacted.

## Develop locally

Use Node.js 24:

```bash
cd frontend
npm ci
npm test -- --watch=false
npm run lint
npm run format:check
npm run build
```

`npm start` serves the demo locally. `npm run build` produces `frontend/dist/frontend/browser/` and copies `index.html` to `404.html` for deep links on GitHub Pages.

## Publish

The [Pages workflow](.github/workflows/pages.yml) checks pull requests and deploys pushes to `main`. In this repository's GitHub settings, set **Pages → Build and deployment → Source** to **GitHub Actions** before the first deployment. The workflow uploads only the static build and needs no credentials for the Argowei API.

When the product dashboard changes, update this snapshot from `argowei/frontend/`, reapply the demo-specific adapter in `frontend/src/app/demo/` and `frontend/src/app/environment.ts`, then run the checks above. Keep the demo's Pages workflow and README in this repository.
