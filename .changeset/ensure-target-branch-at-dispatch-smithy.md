---
"@stoneforge/smithy": patch
---

Ensure target branch exists before worktree creation at dispatch time. Prevents worktree creation failures when a director's targetBranch doesn't exist locally or on the remote.
