# AI E-Library
Node/Express + SQLite REST backend, responsive web console (public/), embedded Claude agent, Android WebView shell (android/).

## Run in VS Code
1. Install Node.js 20+.  2. `npm install`  3. Copy `.env.example` to `.env` and fill it in (add your ANTHROPIC_API_KEY).
4. `npm start` then open http://localhost:3000 (first start downloads ~240 books; wait for "Seeded books").
5. `npm test` runs the API test suite. `npm run dev` restarts on file changes.

## Deploy
Docker (see Dockerfile) on Render/Railway/Fly. Set the same variables from `.env` in the host's dashboard. CI: .github/workflows/ci.yml.
