# Local security and disclosure

This project is designed for a trusted, single-user computer. Do not expose its HTTP port through a public interface, reverse proxy or tunnel. It has no user account system.

Configured MCP servers execute with the current user's privileges. Review server packages and commands before installing them. Tool execution can modify files or remote systems depending on the upstream server.

Credentials are stored locally outside the source tree, without encryption. POSIX files are owner-only; check Windows directory ACLs. Logs redact configured credentials and common secret fields, but redaction is not a guarantee that arbitrary output contains no personal data. Review exports manually before publishing.

Do not include live credentials, private tool output or the local database in public issues. For suspected vulnerabilities, use the repository's private vulnerability reporting channel if enabled; otherwise contact the maintainer privately before sharing exploit details or sensitive data.

The installer backs up client settings under the private data directory. These backups can contain credentials already present in the original client configuration. Never attach `client.before`, `record.json`, `credentials.json` or the data directory to an issue. Client credentials stay in the client environment; freshly entered credentials are stored in the dashboard's private credential file.

Installation is explicit (`setup`), never an npm postinstall hook. It only patches selected MCP entries, uses a local installation lock and verifies the parsed configuration before writing. Keep clients closed during setup/restore to avoid concurrent writes. Restore refuses to overwrite a wrapped entry edited after installation. Raw parser output is not printed because it may quote configuration lines containing secrets.

Automatic background startup is restricted to loopback. A port occupied by an unrelated service or a different data directory is not reused or terminated. The stop command checks the managed process instance before sending SIGTERM. Client configuration determines executable commands; this is a trusted-local-tool boundary, not a sandbox for untrusted MCP packages.
