# Node: root

## Intent
Rename the public Pi extension to @spinejit/pi-spinejit, publish 0.1.0, verify a clean consumer, then deprecate the old package with migration instructions. SDK and host remain at 0.1.0. User authorized the unified rename and release; source edits are restricted to package identity/import references.

## Plan
- Update active tracked names, dependency and owner IDs, docs, lockfile and selective publish workflow. Preserve historical archives and unrelated files.
- Run package tests, checks, pack inspection and isolated install/discovery from a tarball using published SDK/host.
- Commit/push exact changes. Publish the tested tarball and verify registry install before deprecating old package.
- Check Pi detail and directory search separately; record facts without promising indexing.

## State
status: done
last: New package published and verified; old package deprecation verified in public npm registry; release records archived.
next: none for package migration; upstream Pi catalog remains absent at final check.
blocker: none for release/migration; Pi catalog inclusion is externally controlled.

## Evidence
- evidence/ and validation/ hold command results.
- Prior catalog diagnosis in ../pi-plugin/archive/pi_catalog_diagnosis_20261008_1715.

## Gate
- verification: passed 380 tests, 48-file source verification, tarball/registry discovery, seven exports, four tools, Pi install/list; old-package deprecated message verified
- commit: implementation 55a9e9f pushed; verification record 6561ea9; final commit slice docs: complete pi-spinejit package migration
- include: active package identity/import references, release workflow, docs, lockfile
- exclude: archive history, unrelated untracked files, local credentials, runtime semantics

Catalog check: no search matches; direct page returned 404. No claim of directory inclusion.
