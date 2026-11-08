# Issue tracker: GitHub

Issues and specs live in `ChrisKalahiki/paper-bot`. Use the `gh` CLI.

## Operations

- Read: `gh issue view <number> --comments`; include labels when fetching JSON.
- List: `gh issue list --state open --json number,title,body,labels,comments`.
- Create: `gh issue create --title "..." --body-file <path>`.
- Comment: `gh issue comment <number> --body-file <path>`.
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close completed work: `gh issue close <number>`.

Use temporary UTF-8 files for multiline bodies. Inside this clone, gh
infers the repository; elsewhere pass `--repo ChrisKalahiki/paper-bot`.

“Publish to the issue tracker” means create a GitHub issue.
“Fetch the relevant ticket” means read the issue and its comments.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares issue and PR numbers. For an ambiguous reference, try
`gh pr view <number>` and fall back to `gh issue view <number>`.
Read PR changes with `gh pr diff <number>`.

## Maps, tickets and dependencies

- A map is an issue labelled `wayfinder:map`.
- Child tickets use `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling` or `wayfinder:task`.
- Link children through GitHub sub-issues. Where unavailable, use a
  task list in the map and `Part of #<map>` in each child.
- Prefer native issue dependencies. Add a blocker with:
  `gh api --method POST repos/ChrisKalahiki/paper-bot/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-database-id>`.
- Fetch a blocker's database id with:
  `gh api repos/ChrisKalahiki/paper-bot/issues/<number> --jq .id`.
- Where dependencies are unavailable, record `Blocked by: #<number>`
  in the ticket body.
- The frontier is the map's open, unassigned children with no open
  blockers. Select the first in map order.
- Claim with `gh issue edit <number> --add-assignee @me`.
- Resolve by commenting with the outcome, closing the completed
  ticket, and adding a context pointer to the map's Decisions.
