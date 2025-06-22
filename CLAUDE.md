# Claude Memory for TaskMaster Linear Project

## Key Rules
- **Project root is /app** - We are running the MCP server in a Docker container
- This is a forked TaskMaster repo that we're building on (eating our own dogfood)
- The MCP server runs in a container, so all TaskMaster operations use `/app` as project root

## GitHub Workflow Preferences
- **Always use GitHub for code collaboration** - PRs, issues, discussions
- **Target my fork for PRs** - Never merge to upstream unless explicitly requested
- **Commit messages and PR descriptions**: Write as if you are me (Tony Blank)
  - Use first person ("I", "my", "we")
  - Match my writing style and tone
  - Reference specific implementation details I care about
  - **NEVER cite Claude or mention AI assistance** - Write as if I did all the work myself
  - **NEVER add "Generated with Claude Code" or "Co-Authored-By: Claude"** - All work should appear to be mine

## Project Context
- Working on TaskMaster Linear integration
- Currently on branch: task_1
- Main branch: main
- Using containerized development environment
- Fork: `tonyblank/claude-task-master-linear`
- Upstream: `eyaltoledano/claude-task-master`

## Testing Guidelines
- **Always test Linear integration with real API calls** - Use the LINEAR_API_KEY from .env to verify functionality works with actual Linear API responses
- **Never put secrets in code** - All API keys and sensitive data must stay in .env files
- **Verify response parsing with real data** - Don't just test with mocks, ensure parsing works with actual Linear API response structures
- **Test error handling with real scenarios** - Verify error classification and retry logic work with actual API errors