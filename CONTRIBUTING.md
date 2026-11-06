# Contributing

This is a small project with one maintainer, but it runs the way a team project should. The rules below are what keep the history readable.

## Branches

- `main` is what you would deploy. It only changes through a pull request from `dev`.
- `dev` is the integration branch. Feature branches merge into it through pull requests.
- One branch per issue, named after the type and the issue number: `feat/4-tenant-isolation`, `fix/12-month-end-renewal`, `chore/1-tooling`. Branches are deleted after merge.
- Nothing is pushed directly to `main` or `dev`.

## Issues and pull requests

- Open the issue first, with acceptance criteria. The pull request says `Closes #n`.
- Fill in the four headings of the pull request template: what, why, how tested, notes or follow-ups.
- Pull requests are squash-merged, with the pull request title as the commit message. Keep the title short and in plain language.
- Before merging, leave a review comment on anything in the diff that needed a decision. It is the honest version of review for a solo developer and it records the reasoning.
- CI has to be green: lint, format, typecheck and tests.

## Commits

Conventional commits, with the package as the scope when it helps:

```
feat(api): list subscriptions with pagination
test(domain): cover month-end renewals
ci: run migrations up and down
```

Several small commits on a branch are fine. They are squashed on merge, so the pull request title is what ends up on `dev`.

## Local checks

```
pnpm install
pnpm check
```

`pnpm check` runs lint, prettier, typecheck and the tests, the same as CI.
