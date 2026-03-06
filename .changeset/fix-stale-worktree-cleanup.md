---
'@stoneforge/smithy': patch
---

Fix stale worktree directory cleanup in createWorktree to prevent infinite retry loops when a directory exists but is not registered as a git worktree
