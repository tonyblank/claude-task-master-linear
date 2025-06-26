# Linear Integration Setup Guide

This guide covers how to set up and use the Linear integration with TaskMaster.

## Overview

The Linear integration allows TaskMaster to synchronize tasks with Linear issues, enabling seamless project management across both platforms. The integration includes:

- Interactive setup wizard for initial configuration
- Team and project selection
- Label preference configuration
- Automatic configuration file creation
- Real-time sync capabilities

## Prerequisites

1. **Linear Account**: You need access to a Linear workspace
2. **Linear API Key**: Personal API key from Linear Settings → API
3. **Docker Container**: TaskMaster running in Docker container
4. **Project Initialized**: TaskMaster project must be initialized first

## Setup Commands

### 1. Access the Container

```bash
# Start the container (if not running)
docker compose -f docker-compose.mcp.yml up -d

# Access the container shell (Alpine Linux uses sh, not bash)
docker compose -f docker-compose.mcp.yml exec taskmaster-mcp sh
```

### 2. Initialize TaskMaster Project (if not done)

```bash
# Inside the container
/app/bin/task-master.js init --project-root /app --yes
```

### 3. Run the Linear Integration Setup Wizard

```bash
# Basic setup wizard
/app/bin/task-master.js linear-sync-setup

# Options available:
/app/bin/task-master.js linear-sync-setup --dry-run        # Preview what will be configured
/app/bin/task-master.js linear-sync-setup --skip-test      # Skip connection testing
/app/bin/task-master.js linear-sync-setup --project-root /app  # Specify project root
```

## Setup Wizard Flow

The wizard will guide you through these steps:

### Step 1: Linear API Key Validation
- **Prompt**: Enter your Linear API key (input will be masked)
- **Validation**: Key format check and live API test
- **Retry**: Up to 3 attempts with helpful error messages
- **Help**: Instructions on how to get your API key from Linear

### Step 2: Team Selection
- **Fetch**: Retrieves all teams you have access to
- **Display**: Shows team details (name, description, member count, project count)
- **Selection**: 
  - Single team: List selection with search (if >5 teams)
  - Multiple teams: Checkbox selection
  - Auto-select: If only one team available

### Step 3: Project Selection
- **Fetch**: Retrieves projects from selected team(s)
- **Display**: Shows project details and status
- **Selection**: Multiple project selection via checkboxes
- **Validation**: At least one project must be selected

### Step 4: Label Preferences
- **Fetch**: Retrieves existing labels from selected projects
- **Configuration**: 
  - Select which labels to track
  - Configure label filtering rules
  - Set up label-based routing preferences
- **Validation**: Validates label selections against project availability

**Important**: In Linear, labels are owned by **teams**, not individual projects. When TaskMaster creates or manages labels, they are attached to the team level and are available across all projects within that team. This design choice ensures consistency across your team's workflow and prevents label fragmentation.

TaskMaster now provides **comprehensive label management** with the following capabilities:
- **Organization-wide label discovery**: Fetches labels from all teams for complete visibility
- **Linear ID tracking**: Stores Linear label IDs in configuration for sync state management  
- **TaskMaster as source of truth**: Updates Linear labels to match TaskMaster configuration
- **Automatic conflict detection**: Identifies color and description mismatches
- **Modular sync commands**: Granular control for different sync scenarios

### Step 5: Configuration Writing
- **Files Created/Updated**:
  - `.env` - API keys and sensitive data (with proper permissions)
  - `linear-config.json` - Team, project, and label preferences
- **Backup**: Creates backup of existing files
- **Validation**: Verifies file write operations and data integrity

### Step 6: Success Confirmation
- **Summary**: Displays configuration summary
- **Testing**: Optional configuration testing (can be skipped with `--skip-test`)
- **Next Steps**: Provides guidance on using the integration
- **Troubleshooting**: Links to help and support resources

## Configuration Files

After successful setup, you'll have:

### `.env` File
```bash
# Linear Integration
LINEAR_API_KEY=lin_api_your_key_here
LINEAR_TEAM_IDS=team-id-1,team-id-2
LINEAR_PROJECT_IDS=project-id-1,project-id-2
```

### `linear-config.json` File
```json
{
  "version": "1.0.0",
  "teams": [
    {
      "id": "team-id",
      "name": "Team Name",
      "key": "TEAM"
    }
  ],
  "projects": [
    {
      "id": "project-id", 
      "name": "Project Name",
      "teamId": "team-id"
    }
  ],
  "labels": {
    "tracking": ["bug", "feature"],
    "filtering": {
      "include": ["priority:high"],
      "exclude": ["status:done"]
    }
  }
}
```

## Using the Integration

### Enhanced Label Management

TaskMaster provides comprehensive label sync capabilities:

```bash
# Analyze current label sync state (dry run)
/app/bin/task-master.js linear-sync-labels --dry-run

# Sync all labels (create missing, update Linear IDs)
/app/bin/task-master.js linear-sync-labels

# Resolve conflicts (update Linear to match TaskMaster)
/app/bin/task-master.js linear-sync-labels --resolve-conflicts

# Sync specific components
/app/bin/task-master.js linear-sync-teams     # Team synchronization
/app/bin/task-master.js linear-sync-all       # Complete sync (teams + labels + projects)
```

### Sync Tasks to Linear
```bash
# After setup, create tasks that will sync to Linear
/app/bin/task-master.js add-task --prompt "Create new feature for user authentication"

# Update task status (syncs to Linear)
/app/bin/task-master.js set-status --id 1 --status in-progress
```

### Check Integration Status
```bash
# List tasks with Linear sync status
/app/bin/task-master.js list --with-linear-status

# View specific task details
/app/bin/task-master.js show --id 1
```

## Troubleshooting

### Common Issues

1. **API Key Errors**
   - Verify key starts with `lin_api_` 
   - Check key hasn't expired
   - Ensure proper permissions in Linear

2. **No Teams Found**
   - Verify account has team access
   - Check Linear workspace permissions

3. **Configuration File Errors**
   - Ensure `/app` directory is writable
   - Check file permissions for `.env`

### Re-running Setup
```bash
# Re-run wizard to update configuration
/app/bin/task-master.js linear-sync-setup

# Preview changes without applying
/app/bin/task-master.js linear-sync-setup --dry-run
```

### Validation Commands
```bash
# Test current configuration
/app/bin/task-master.js linear-sync-setup --skip-test=false

# Validate dependencies
/app/bin/task-master.js validate-dependencies
```

## Security Notes

- API keys are stored in `.env` with restricted permissions
- Never commit `.env` files to version control
- Linear API keys should be rotated periodically
- Use team-specific API keys when possible

## Support

For issues with the Linear integration:

1. Check the troubleshooting section above
2. Review the generated configuration files
3. Test with `--dry-run` to preview changes
4. Verify Linear API key permissions
5. Re-run setup wizard if configuration appears corrupted

## Command Reference

| Command | Description | Options |
|---------|-------------|---------|
| `linear-sync-setup` | Interactive setup wizard | `--dry-run`, `--skip-test`, `--project-root` |
| `sync-readme` | Export tasks to README | `--with-subtasks` |
| `list` | List tasks | Various filtering options |
| `add-task` | Create new task | `--prompt`, sync to Linear automatically |
| `set-status` | Update task status | `--id`, `--status`, syncs to Linear |
