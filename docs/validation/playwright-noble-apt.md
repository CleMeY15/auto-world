# Playwright native dependency downloads on Noble

Implementation owner: Codex gpt-6.2-astra, ultra, branch
`t3/fix-playwright-apt-mirror`, base `b5f7a03fb44239ff5a73a66ca4c496f0cfc4f581`.
Parent owns independent review and delivery order. This CI maintenance uses the
[development workflow](../DEVELOPMENT_WORKFLOW.md) and
[persistent web contract](../PROTOTYPE_WEB.md).

[Main attempt 1](https://github.com/CleMeY15/auto-world/actions/runs/44373389545/job/135045950316)
timed out after 25 minutes during apt downloads from the us-east-2 EC2 archive.
The earlier [web job](https://github.com/CleMeY15/auto-world/actions/runs/44358775026/job/134994232362)
and [quality job](https://github.com/CleMeY15/auto-world/actions/runs/44358775210/job/134994228126)
fetched the same 125 MB in 24m10s on EC2 and 9s on Azure, respectively.

Plan: replace that exact Ubuntu archive URI on the two ephemeral Noble runners,
exercise apt source fixtures and both workflow contracts, then use the normal PR
jobs to verify the package fetch, unpack, setup and both browser journeys.
Local fixtures run in an owned temporary directory. Revert this change to restore
the runner-selected archive on subsequent jobs. No migration is required.

Local frozen install passed (Node 22.23.2, pnpm 10.15.0). The focused command
`node --test tests/playwright-apt-mirror.test.mjs tests/prototype-web-workflow.test.mjs tests/workspace-contract.test.mjs`
passed 17/17. It exercises the normal helper entry point with deb822 and
one-line sources, compares complete file contents, then checks a second
invocation changes zero files. A local HTTPS request for Noble InRelease
returned HTTP 200 in 0.23 s. This measures reachability only.

Hosted verification: inspect the original install step in each draft-PR job
for the helper's changed-file count, actual apt host, fetched bytes/time, dpkg
unpacking and setup, and Playwright's two browser downloads. A zero count on a
different runner mirror exercises the no-op path. Use the following browser
test steps and uploaded artifacts for functional evidence. No local system apt
files were modified. Hosted results and independent review are pending at
source submission.
