# Linear Configuration Schema Design

## Overview

This document defines the schema design for Linear integration configuration within Taskmaster's config.json system. The design extends the existing configuration structure while maintaining backward compatibility.

## Schema Structure

### Extended config.json Format

```json
{
  "models": {
    // Existing model configuration unchanged
  },
  "global": {
    // Existing global configuration unchanged
  },
  "integrations": {
    "linear": {
      "enabled": true,
      "apiKey": "${LINEAR_API_KEY}",
      "team": {
        "id": "team-id-uuid",
        "name": "Engineering Team"
      },
      "project": {
        "id": "project-id-uuid", 
        "name": "Main Project"
      },
      "labels": {
        "enabled": true,
        "sourceLabel": "taskmaster",
        "priorityMapping": {
          "high": "High Priority",
          "medium": "Medium Priority", 
          "low": "Low Priority"
        },
        "statusMapping": {
          "pending": "Todo",
          "in-progress": "In Progress",
          "review": "In Review",
          "done": "Done",
          "cancelled": "Cancelled",
          "deferred": "Backlog"
        }
      },
      "sync": {
        "autoSync": true,
        "syncOnStatusChange": true,
        "syncSubtasks": true,
        "syncDependencies": true,
        "batchSize": 10,
        "retryAttempts": 3,
        "retryDelay": 1000
      },
      "webhooks": {
        "enabled": false,
        "url": null,
        "secret": null
      }
    }
  }
}
```

### Environment Variable Schema

Required environment variables in `.env`:

```bash
# Linear Integration
LINEAR_API_KEY=lin_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Optional: Override config values
LINEAR_TEAM_ID=override-team-id
LINEAR_PROJECT_ID=override-project-id
```

## Schema Validation Rules

### Required Fields
- `integrations.linear.apiKey`: Must be a valid Linear API key (starts with "lin_api_")
- `integrations.linear.team.id`: Must be a valid UUID format
- `integrations.linear.project.id`: Must be a valid UUID format

### Optional Fields with Defaults
- `integrations.linear.enabled`: Default `false`
- `integrations.linear.sync.autoSync`: Default `true`
- `integrations.linear.sync.batchSize`: Default `10`, range 1-50
- `integrations.linear.sync.retryAttempts`: Default `3`, range 1-10
- `integrations.linear.sync.retryDelay`: Default `1000` (ms), range 100-5000

### Field Constraints
- All mapping objects must have string keys and string values
- Batch size must not exceed Linear API rate limits
- API key validation should check format but not make live API calls during config load

## Configuration Access Patterns

### Getter Functions
```javascript
// Core Linear config
getLinearConfig(explicitRoot = null)
getLinearApiKey(explicitRoot = null) 
getLinearTeamId(explicitRoot = null)
getLinearProjectId(explicitRoot = null)

// Feature flags
isLinearEnabled(explicitRoot = null)
isLinearAutoSyncEnabled(explicitRoot = null)
isLinearSubtaskSyncEnabled(explicitRoot = null)

// Mappings
getLinearStatusMapping(explicitRoot = null)
getLinearPriorityMapping(explicitRoot = null)

// Sync settings
getLinearSyncSettings(explicitRoot = null)
```

### Validation Functions
```javascript
validateLinearConfig(config)
validateLinearApiKey(apiKey)
validateLinearTeamId(teamId)
validateLinearProjectId(projectId)
```

## Migration Strategy

### Phase 1: Schema Definition
1. Define schema structure in config-manager.js
2. Add Linear-specific getter functions
3. Maintain full backward compatibility

### Phase 2: Environment Integration
1. Integrate with existing environment variable resolution
2. Support ${VAR} placeholder syntax for sensitive values
3. Add dotenv loading for .env files

### Phase 3: Validation Layer
1. Add schema validation on config load
2. Provide helpful error messages for invalid configurations
3. Support config file migration/upgrade utilities

## Security Considerations

### API Key Storage
- Never store API keys directly in config.json
- Always use environment variable placeholders: `"${LINEAR_API_KEY}"`
- Support .env file loading for development
- Validate API key format without making API calls

### Configuration Validation
- Validate UUID formats for team and project IDs
- Sanitize all string inputs to prevent injection
- Rate limit configuration reloads to prevent abuse

## Performance Implications

### Configuration Loading
- Cache configuration after first load
- Invalidate cache only when explicitly requested
- Lazy-load Linear-specific validation to avoid startup delays

### Environment Variable Resolution
- Cache resolved environment variables
- Support hot-reloading in development environments
- Minimize disk I/O for repeated config access

## Example Configurations

### Minimal Configuration
```json
{
  "integrations": {
    "linear": {
      "enabled": true,
      "apiKey": "${LINEAR_API_KEY}",
      "team": {"id": "team-uuid", "name": "Engineering"},
      "project": {"id": "project-uuid", "name": "Main"}
    }
  }
}
```

### Full Configuration
```json
{
  "integrations": {
    "linear": {
      "enabled": true,
      "apiKey": "${LINEAR_API_KEY}",
      "team": {"id": "team-uuid", "name": "Engineering Team"},
      "project": {"id": "project-uuid", "name": "Main Project"},
      "labels": {
        "enabled": true,
        "sourceLabel": "taskmaster",
        "priorityMapping": {
          "high": "P0 - Critical",
          "medium": "P1 - High", 
          "low": "P2 - Normal"
        },
        "statusMapping": {
          "pending": "Todo",
          "in-progress": "In Progress",
          "review": "In Review", 
          "done": "Done",
          "cancelled": "Cancelled",
          "deferred": "Backlog"
        }
      },
      "sync": {
        "autoSync": true,
        "syncOnStatusChange": true,
        "syncSubtasks": true,
        "syncDependencies": true,
        "batchSize": 20,
        "retryAttempts": 5,
        "retryDelay": 2000
      }
    }
  }
}
```

## Testing Strategy

### Unit Tests
- Test configuration loading with various schemas
- Test environment variable resolution
- Test validation functions with valid/invalid inputs
- Test backward compatibility with existing configs

### Integration Tests  
- Test config loading with real .env files
- Test Linear API key validation
- Test configuration migration scenarios

### Edge Cases
- Missing .env files
- Invalid JSON in config files
- Malformed environment variables
- Network timeouts during validation