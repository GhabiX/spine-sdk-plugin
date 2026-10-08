# Node: root

## Intent
Rename the public Pi extension to @spinejit/pi-spinejit, publish 0.1.0, verify a clean consumer, then deprecate the old package with migration instructions. SDK and host remain at 0.1.0. User authorized the unified rename and release; source edits are restricted to package identity/import references.

## Plan
- Update active tracked names, dependency and owner IDs, docs, lockfile and selective publish workflow. Preserve historical archives and unrelated files.
- Run package tests, checks, pack inspection and isolated install/discovery from a tarball using published SDK/host.
- Commit/push exact changes. Publish the tested tarball and verify registry install before deprecating old package.
- Check Pi detail and directory search separately; record facts without promising indexing.

## State
status: blocked
last: Commit 55a9e9f pushed; new 0.1.0 public; registry consumer and Pi CLI install/list verified.
next: Complete npm deprecation 2FA, verify old-package warning and catalog, archive evidence and commit release record.
blocker: npm deprecation awaits user web 2FA.

## Evidence
- evidence/ and validation/ hold command results.
- Prior catalog diagnosis in ../pi-plugin/archive/pi_catalog_diagnosis_20261008_1715.

## Gate
- verification: passed 380 tests, 48-file source verification, tarball/registry discovery, seven exports, four tools, Pi install/list; deprecation 2FA pending
- commit: implementation 55a9e9f pushed; this record slice docs: record pi-spinejit release verification
- include: active package identity/import references, release workflow, docs, lockfile
- exclude: archive history, unrelated untracked files, local credentials, runtime semantics
