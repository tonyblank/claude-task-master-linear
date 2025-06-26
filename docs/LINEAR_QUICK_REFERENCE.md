# Linear Integration - Quick Reference

## Essential Commands

### Setup (Run Once)
```bash
# Access container (Alpine Linux uses sh)
docker compose -f docker-compose.mcp.yml exec taskmaster-mcp sh

# Initialize project (if needed)
/app/bin/task-master.js init --project-root /app --yes

# Run Linear setup wizard
/app/bin/task-master.js linear-sync-setup
```

### Wizard Options
```bash
/app/bin/task-master.js linear-sync-setup --dry-run      # Preview only
/app/bin/task-master.js linear-sync-setup --skip-test    # Skip connection test
```

## What You Need

1. **Linear API Key** 
   - Go to: Linear Settings → API → Create Personal API Key
   - Starts with: `lin_api_`

2. **Team Access**
   - Must have access to at least one Linear team
   - Know which projects you want to sync

## Wizard Steps

1. **API Key** → Enter your Linear API key (masked input)
2. **Teams** → Select team(s) from your Linear workspace  
3. **Projects** → Choose project(s) within selected teams
4. **Labels** → Configure which labels to track and sync
5. **Config** → Writes `.env` and `linear-config.json` files
6. **Test** → Optional connection verification

## Files Created

- **`.env`** → API keys and IDs (sensitive data)
- **`linear-config.json`** → Team/project/label preferences

## After Setup

Tasks created in TaskMaster will automatically sync to Linear as issues.

## Troubleshooting

- **No teams found**: Check Linear workspace access
- **API errors**: Verify key permissions and expiration
- **File errors**: Ensure `/app` directory is writable
- **Re-run setup**: Just run `linear-sync-setup` again to reconfigure

## Next Steps

After setup completion:
1. Create tasks: `/app/bin/task-master.js add-task --prompt "Your task"`
2. Update status: `/app/bin/task-master.js set-status --id 1 --status in-progress`
3. Check sync: `/app/bin/task-master.js list`