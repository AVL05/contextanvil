# Claude Code

Install the [local adapter](../mcp.md), then register it from the working
project. Use absolute paths and quote any argument containing spaces.

```sh
claude mcp add --scope local --transport stdio contextanvil -- node /absolute/path/to/contextanvil/mcp/server.js --repo "app=/absolute/path/to/project"
claude mcp list
```

Local scope is project-specific. ContextAnvil never changes Claude Code
settings itself. See the [Claude Code MCP guide](https://code.claude.com/docs/en/mcp).

Sample request:

> Use ContextAnvil's get_task_context with repository app to locate the
> navigation component and its tests. Cite the files you would inspect.

On Windows, prefer the full path to `node.exe` if Claude Code cannot find Node.
Check that the adapter's dependencies are installed and the startup argument
is a valid absolute directory. Use `claude mcp list` or `/mcp` to check
connection state. Startup diagnostics appear on the server's stderr. A busy
or timeout result is a tool-level error.

Claude Code 2.1.318 registered the server in an isolated configuration and
reported Connected during its MCP health check. This checked the connection
without an authenticated model turn.
