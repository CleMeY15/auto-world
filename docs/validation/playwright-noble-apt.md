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

The failed run logs `file:/etc/apt/apt-mirrors.txt Mirrorlist [152 B]` during
both update and package download. The [runner image build recipe](https://github.com/actions/runner-images/blob/f2f91839f985dcbde42542557c72de8d0c2970a6/images/ubuntu/scripts/build/configure-apt-sources.sh)
writes a tab-delimited priority list and points Noble's deb822 source at it.
Its three EC2-runner lines total exactly 152 bytes. The initial draft targeted
ordinary sources; inspecting the transport log identified the required correction.

Plan: in both ephemeral Noble install steps, remove the exact EC2 priority-1
entry only when the official HTTPS archive priority-2 fallback exists. Preserve
the remaining bytes, including the security mirror. Other runner configurations
keep their existing selection. Playwright installs native packages and both
browsers with a 60-minute install limit. The quality and persistent-web jobs
each allow 120 minutes overall for preparation, installation and validation. Revert to restore runner
defaults on subsequent jobs. No migration is required.

Local frozen install passed (Node 22.23.2, pnpm 10.15.0). The focused command
`node --test tests/playwright-apt-mirror.test.mjs tests/prototype-web-workflow.test.mjs tests/workspace-contract.test.mjs`
passed 17/17. It runs the helper against the 152-byte mirror list, checks the
remaining bytes, then covers a second run, Azure, absent file, comments and
absent official fallback. A local HTTPS request for Noble InRelease returned
HTTP 200 in 0.23 s. This measures reachability only.

Hosted verification: inspect the original install step in each final-head PR
job for the helper's selection, actual apt host, fetched bytes/time, dpkg
unpacking and setup, and Playwright's browser downloads. A different runner
mirror exercises the no-op path. Use the following browser test steps and
uploaded artifacts for functional evidence. No local system apt files were
modified. Hosted results and independent review are pending at source submission.
