# SME ERP

A lightweight multi-tenant ERP for small businesses, built with Next.js 16 and Supabase.

## Project Docs (humans and AI agents)

- [AGENTS.md](AGENTS.md): engineering rules for all contributors and agents (Codex, Claude Code, ChatGPT)
- [CLAUDE.md](CLAUDE.md): Claude Code entry point
- [docs/PRODUCT.md](docs/PRODUCT.md): Version 1 scope and non-scope
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): stack, layering, auth flow
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md): planned data model
- [docs/SECURITY.md](docs/SECURITY.md): security rules
- [docs/DECISIONS.md](docs/DECISIONS.md): decision log
- [docs/ROADMAP.md](docs/ROADMAP.md): delivery phases
- [tasks/current.md](tasks/current.md): the active task

Environment: copy the required variable names listed in `docs/ARCHITECTURE.md` into `.env.local`. Never commit that file.

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
