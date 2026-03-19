---
"@stoneforge/smithy": patch
---

Fix silent push failure in mergeBranch: return failure result when git push fails instead of reporting success, and add post-push verification to confirm the commit landed on the remote.
