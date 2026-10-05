# Activity sync

The portfolio reads `data/activity.json`. A nightly GitHub Action builds that file from your personal account and your Standards I.T. account.

## What gets published
- Daily contribution counts for each account (the same numbers a GitHub profile heatmap shows)
- Weekly commit counts for the last 12 weeks, per project you list in `activity.config.json`
- The alias, summary and tags you write for each project

## What never gets published
- Private repository names, URLs or owners. The config matches repos by hash, not by name
- Code, commit messages, branches, file names
- Anything from repos you don't list. Those count toward one anonymous "other private repositories" total

The script refuses to write the file if a private repo name or the work login shows up anywhere in the output.

## Setup
1. Check with Standards I.T. that publishing anonymized activity counts is fine.
2. Copy `scripts/`, `.github/workflows/activity.yml` and `activity.config.json` into your Pages repo.
3. Create tokens:
   - **Standards account:** a classic token with `repo` (read) and `read:user`. If the org uses SSO, authorize the token for the org.
   - **Personal account (optional):** a classic token with `read:user`, so your personal private contributions count too.
4. Add these repository secrets: `PERSONAL_LOGIN`, `WORK_LOGIN`, `GH_WORK_TOKEN`, `GH_PERSONAL_TOKEN`.
5. On your own machine, print the repo hashes:
   `PERSONAL_LOGIN=… WORK_LOGIN=… GH_WORK_TOKEN=… GH_PERSONAL_TOKEN=… node scripts/build-activity.mjs --hashes`
   Paste the hashes into `activity.config.json`. Don't run `--hashes` in CI, because Actions logs on a public repo are public.
6. Run **Sync GitHub activity** once from the Actions tab. After that it runs every night.

## Projects without a repository
A project with no repos (for example SQL Server and Power BI work) can still be listed: give it `"repos": []`, `"alwaysShow": true` and a `"badge"` line to show in place of the commit chart, such as `"SQL Server and Power BI at Standards I.T."`.
