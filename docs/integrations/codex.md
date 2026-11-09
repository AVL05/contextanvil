# OpenAI Codex

Install the [local adapter](../mcp.md). Add this entry to your Codex
`config.toml`. Replace both absolute paths with local paths. Use forward
slashes in Windows paths or escape backslashes in TOML strings.

```toml
[mcp_servers.contextanvil]
command = "node"
args = ["/absolute/path/to/contextanvil/mcp/server.js", "--repo", "app=/absolute/path/to/project"]
tool_timeout_sec = 20
```

You can also register it explicitly with the CLI:

```sh
codex mcp add contextanvil -- node /absolute/path/to/contextanvil/mcp/server.js --repo "app=/absolute/path/to/project"
codex mcp list
```

The CLI command changes your Codex configuration when you run it.
ContextAnvil never performs registration itself. See the
[official Codex MCP configuration](https://developers.openai.com/codex/mcp).

Sample request:

> Call get_task_context for repository app and task "Update Navigation".
> List the relevant source and test files with evidence.

If startup fails, check the Node executable, the server script path and the
`--repo` value. Use an absolute executable path if PATH differs in the
client. Set the host's timeout above the adapter's deadline. Server startup
and transport diagnostics go to stderr.

Codex CLI 0.166.0, running its app server with an isolated configuration,
discovered all three tools and called `get_task_context` on the Next.js fixture.
It returned the navigation component and its test. This was a native MCP
client call without an authenticated model turn.
