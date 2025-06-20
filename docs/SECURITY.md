# Security Guidelines for TaskMaster Linear

## Overview

TaskMaster implements comprehensive security practices for credential management, environment variable handling, and secure configuration. This document consolidates security best practices and guidelines.

## Credential Management

### API Key Security

- **✅ Implemented**: Never store API keys directly in configuration files
- **✅ Implemented**: Use environment variable placeholders: `"${LINEAR_API_KEY}"`
- **✅ Implemented**: Support for `.env` file loading in development
- **✅ Implemented**: API key format validation without live API calls

### Environment Variable Resolution

TaskMaster uses a secure multi-source resolution hierarchy:

1. **Session environment** (MCP session.env) - Highest priority
2. **Project .env file** (using dotenv parsing)
3. **Process environment** (process.env) - Fallback

```javascript
// Implementation in scripts/modules/utils.js:34-65
function resolveEnvVariable(key, session, projectRoot) {
  // 1. Check session.env first
  if (session?.env?.[key]) return session.env[key];
  
  // 2. Check .env file at projectRoot with dotenv
  if (projectRoot) {
    const envPath = path.join(projectRoot, '.env');
    const parsedEnv = dotenv.parse(envFileContent);
    if (parsedEnv?.[key]) return parsedEnv[key];
  }
  
  // 3. Fallback to process.env
  return process.env[key];
}
```

### Supported Credentials

- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`
- `PERPLEXITY_API_KEY`, `XAI_API_KEY`, `MISTRAL_API_KEY`
- `AZURE_OPENAI_API_KEY`, `OLLAMA_API_KEY`
- `LINEAR_API_KEY` - For Linear integration
- `GITHUB_API_KEY` - For GitHub operations

## Configuration Security

### Validation & Sanitization

- **Input Validation**: API key format validation (`validateLinearApiKey()`)
- **UUID Validation**: Team/project IDs validated with regex patterns
- **Input Sanitization**: `sanitizePrompt()` for shell command safety
- **Path Validation**: Prevents directory traversal attacks

### Configuration Files

- **Config files**: Store non-sensitive settings only
- **Environment placeholders**: Required for all sensitive values
- **Gitignore protection**: `.env` files excluded from version control
- **Permissions**: Config files should have restricted permissions

## Linear Integration Security

### API Key Requirements

```bash
# .env file format
LINEAR_API_KEY=lin_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Security Features

- **Format validation**: Keys must start with `lin_api_` and be ≥40 characters
- **UUID validation**: Team/project IDs validated against UUID format
- **Rate limiting**: Configurable retry attempts and delays
- **Batch size limits**: Prevents API abuse with configurable batch sizes

## Development Security

### Best Practices

1. **Environment Setup**:
   - Copy `.env.example` to `.env`
   - Never commit `.env` files to version control
   - Use meaningful, non-production keys in development

2. **Configuration Management**:
   - Use `task-master models --setup` for interactive configuration
   - Validate configuration with `task-master validate-config`
   - Test environment variable resolution

3. **Code Security**:
   - Input validation for all user inputs
   - Proper error handling without exposing sensitive information
   - Safe shell command execution with input sanitization

## Container Security

### Docker Environment

- Environment variables passed through Docker Compose
- Secure volume mounting for configuration files
- Production environment isolation
- Non-root user execution where possible

### MCP Server Security

- Environment variable isolation
- Temporary environment variable management with `withSessionEnv()`
- Proper cleanup of temporary variables
- Session-based credential injection

## Incident Response

### API Key Compromise

If an API key is compromised:

1. **Immediate Actions**:
   - Rotate the compromised key immediately
   - Update the new key in your environment
   - Restart any running TaskMaster processes

2. **Assessment**:
   - Review logs for unauthorized usage
   - Check for any data exposure
   - Verify other keys are not compromised

3. **Prevention**:
   - Audit environment variable storage
   - Review access to `.env` files
   - Consider using credential managers for production

### Security Monitoring

- Monitor API usage for unusual patterns
- Log authentication failures (without exposing keys)
- Regular credential rotation schedule
- Audit configuration file permissions

## Production Deployment

### Checklist

- [ ] All API keys stored in secure credential management system
- [ ] Environment variables properly isolated
- [ ] Configuration files have restricted permissions
- [ ] Logs don't contain sensitive information
- [ ] Network connections use HTTPS/TLS
- [ ] Regular security updates applied
- [ ] Backup and recovery procedures tested

### Credential Managers

For production environments, consider using:

- **AWS Secrets Manager**: For AWS deployments
- **Azure Key Vault**: For Azure deployments
- **Google Secret Manager**: For GCP deployments
- **HashiCorp Vault**: For on-premises or multi-cloud

## Security Testing

### Validation

```bash
# Test environment variable resolution
task-master debug env-vars

# Validate configuration security
task-master validate-config

# Check API key formats
task-master models --check-keys
```

### Automated Testing

- Unit tests for validation functions
- Integration tests for environment variable resolution
- Security tests for input sanitization
- Configuration migration tests

## Reporting Security Issues

To report security vulnerabilities:

1. **Do not** create public issues for security vulnerabilities
2. Email security concerns to the project maintainers
3. Include detailed information about the vulnerability
4. Allow reasonable time for response and patching

## References

- [Configuration Documentation](./configuration.md)
- [Linear Integration Schema](./linear-config-schema.md)
- [Environment Variables Guide](.env.example)
- [API Provider Security](../scripts/modules/ai-providers/)