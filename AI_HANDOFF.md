# Holdfast AI Handoff

## Project

Holdfast is the website and software foundation for the Holdfast World of Warcraft guild.

Repository:
https://github.com/Indicaza/holdfast

Current priority:

1. Build a polished public guild website.
2. Create a seamless pipeline from the website into Discord.
3. Establish a small backend foundation for guild membership and integrations.
4. Experiment with WoW addons, GuildOS, Discord automation, and game-data integrations after the public foundation works.

Do not prematurely build the larger GuildOS vision.

## Current Stack

Frontend:
- React
- Vite
- JavaScript

Backend:
- Node.js
- Express

Repository structure:

- `frontend/` owns the website and browser UI.
- `backend/` owns APIs, Discord integration, persistence, services, and future GuildOS server functionality.
- Additional top-level applications such as `addon/` or `archivist-plugin/` should only be introduced when they actually exist.

## Architecture

Use simple fractal architecture.

The governing rule is:

**Ownership > file type.**

Everything required to understand or modify a feature should live as close to that feature as practical.

Prefer:

`Feature/`
  `Feature.jsx`
  `Feature.css`
  `FeatureHelper.js`
  `SubFeature/`

over spreading one feature across giant global directories such as:

`components/`
`hooks/`
`utils/`
`styles/`

Drill downward by domain and ownership.

Components may own smaller components.

Features may own feature-specific services, helpers, styles, assets, and data.

Promote something into shared/global infrastructure only when it is genuinely reused across unrelated domains.

Avoid Atomic Design, unnecessary abstraction layers, fake enterprise architecture, and speculative generalization.

This is a small website. Keep it pleasurable to navigate.

## Styling

The site uses centralized design tokens so the visual identity can be changed from one place.

Tokens should own global visual primitives such as:

- colors
- typography
- spacing
- radii
- shadows
- borders
- transitions
- layout widths
- layering/z-index values

Component styles remain co-located with their owning components.

Do not turn the token system into a design framework.

## Design Direction

The landing page is cinematic and editorial.

Primary characteristics:

- full-page rotating background artwork
- dark atmospheric presentation
- restrained warm/gold accents
- strong typography
- clean spacing
- translucent/dark feature cards
- subtle motion
- minimal clutter
- responsive/mobile-friendly design

The website should look intentionally designed rather than like a generic gaming template.

## Initial Landing Page

Likely major pieces:

- Navbar
- HeroSlideshow
- HeroContent
- HeroRail
- FeatureCardGrid
- FeatureCard
- GuildStatement
- FoundingCallout
- Footer

Routes can initially remain minimal:

- `/`
- `/charter`
- `/guildos`
- `/join`

Do not build functionality simply because a route exists.

## Development Rules

Before modifying code:

1. Read `README.md`.
2. Read `AI_HANDOFF.md`.
3. Inspect the supplied context file.
4. Determine which files actually own the requested behavior.
5. Request additional context when necessary.
6. Make the smallest coherent change.

Do not freestyle architecture.

Follow existing naming and structural conventions once established.

Prefer complete vertical slices over scattered partial implementations.

Avoid unrelated refactors.

Do not introduce dependencies without a concrete reason.

Do not move files merely to satisfy a preferred abstract structure.

## AI Context Workflow

The developer provides:

- `README.md`
- `AI_HANDOFF.md`
- a generated context file when code context is needed

The AI may also inspect:

https://github.com/Indicaza/holdfast

GitHub is useful for repository history and committed state.

The developer's local context is authoritative because local changes may not yet exist on GitHub.

When more context is required, the AI should provide a command using `scripts/context.sh`.

The AI should request only the files relevant to the task rather than dumping the entire repository.

Example:

`./scripts/context.sh context001.txt . frontend/src/App.jsx frontend/src/App.css frontend/src/theme/tokens.css`

The resulting context file contains repository metadata, project structure, git state, and explicitly requested file contents.

## Patch Workflow

Once sufficient context exists, the AI should provide a unified Git patch.

Patch files live temporarily at the repository root.

Before applying:

`git apply --check holdfast001.patch`

Apply:

`git apply holdfast001.patch`

The AI should also provide the appropriate verification command after the patch.

Patches are disposable working artifacts and should not require a permanent patch directory.

After the developer applies and verifies the patch, repeat the context -> patch loop as needed.

## AI Response Behavior

When context is insufficient:

- Ask for the smallest useful set of files.
- Prefer giving the exact `context.sh` command.
- Do not guess existing implementation details.

When context is sufficient:

- Briefly explain the intended change.
- Produce the patch.
- Give the apply command.
- Give the verification command.

Keep development communication concise unless architectural reasoning is specifically requested.

## Near-Term Boundary

For now, prioritize:

- public exposure
- visual identity
- guild information
- Discord onboarding
- basic membership infrastructure

Future ideas include GuildOS, Discord automation, WoW addons, Archivist integration, guild roster synchronization, bank ledger, profession tracking, Auction House intelligence, Writs, and economic tooling.

Those ideas should inform clean boundaries but should not cause speculative implementation now.
