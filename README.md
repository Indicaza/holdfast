# Holdfast

Holdfast is the public website and software foundation for the **Holdfast** World of Warcraft guild.

The immediate goal is simple:

- give the guild a strong public presence
- explain who we are and what we value
- provide a seamless path into our Discord
- establish the technical foundation for future guild tools

Over time, Holdfast may grow into a broader **GuildOS** connecting the website, Discord, World of Warcraft addons, guild data, economic tools, and other services.

For now, the focus is the guild website and onboarding experience.

## Philosophy

**Leave it stronger.**

Holdfast is intended to be an organized, durable guild without making the game feel like a second job.

The software follows the same philosophy.

Tools should reduce friction rather than create more work for members.

The long-term goal is for systems such as recruiting, organization, guild-bank accounting, professions, events, Discord roles, and economic coordination to happen as automatically as practical while keeping humans in control.

## Current Scope

The project currently focuses on:

- public guild website
- visual identity and branding
- guild information and charter
- Discord onboarding
- basic membership infrastructure
- foundations for future GuildOS integrations

Future experimentation may include:

- Discord automation
- World of Warcraft addons
- guild roster synchronization
- guild-bank ledger and inventory
- profession and recipe tracking
- Auction House market data
- economic Writs and guild opportunities
- Archivist integration
- GuildOS dashboards and tooling

These are future directions rather than requirements for the initial release.

## Tech Stack

### Frontend

- React
- Vite
- JavaScript

### Backend

- Node.js
- Express

### Planned Infrastructure

- Discord OAuth and bot integration
- relational persistence for guild and member data
- cloud deployment with simple CI/CD

## Repository Structure

holdfast/
├── frontend/
│ └── React website
├── backend/
│ └── API, integrations, and server-side services
├── scripts/
│ └── development and AI context tooling
├── AI_HANDOFF.md
└── README.md

Additional applications such as a WoW addon or Archivist plugin will receive their own top-level directories if and when they are actually built.

## Architecture

Holdfast uses a lightweight **fractal architecture**.

The basic rule is:

**Ownership > file type.**

Files that belong to a feature should live close to that feature rather than being scattered across large global folders.

Feature/
├── Feature.jsx
├── Feature.css
├── FeatureHelper.js
└── SubFeature/

Shared infrastructure should only become global when it is genuinely shared across unrelated parts of the application.

The project intentionally avoids unnecessary enterprise architecture, Atomic Design hierarchies, and speculative abstraction.

## Design System

The frontend will use centralized design tokens for global visual primitives such as:

- colors
- typography
- spacing
- borders
- radii
- shadows
- transitions
- layout widths
- layering

Component-specific styling remains close to the component that owns it.

This allows the overall visual identity of Holdfast to be changed from a small number of centralized values without creating a large design framework.

## Visual Direction

The public website is intended to feel cinematic, atmospheric, and professionally designed.

The current direction includes:

- full-screen rotating background artwork
- dark environmental imagery
- restrained warm and gold accents
- strong editorial typography
- translucent feature cards
- generous spacing
- subtle motion
- responsive layouts
- minimal visual clutter

The goal is a modern guild website rather than a generic gaming template.

## Development

Install the frontend:

cd frontend
npm install
npm run dev

Install and run the backend:

cd backend
npm install
npm run dev

## AI-Assisted Development

Holdfast includes a lightweight workflow for working with AI across development sessions.

See:

AI_HANDOFF.md

The repository also contains a context-generation script:

./scripts/context.sh context001.txt . README.md AI_HANDOFF.md

The script can collect:

- repository information
- current branch
- current commit
- git status
- project tree
- explicitly requested files

This allows an AI assistant to request only the context it needs and return small Git patches that can be reviewed and applied locally.

Typical workflow:

README + AI_HANDOFF
↓
targeted context file
↓
AI-generated Git patch
↓
git apply --check
↓
git apply
↓
verify
↓
repeat

Local working-tree context is authoritative.

The GitHub repository is used as a reference for committed state and history.

## Repository

https://github.com/Indicaza/holdfast

## Status

Holdfast is in early development.

The current priority is:

**Website → Discord → Guild**

Everything beyond that will be added only when it provides real value.
