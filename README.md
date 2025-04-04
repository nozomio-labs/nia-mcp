# Nia Codebase MCP

The Nia Codebase MCP server allows you to integrate with Nia's codebase understanding capabilities through function calling in tools like Cursor, Claude Desktop, and other MCP-compatible clients.

## Installation

You can use this MCP server without installing it using npx:

```bash
npx -y nia-codebase-mcp@1.0.0 --api-key=YOUR_NIA_API_KEY --transport=stdio
```

## Transport Options

The Nia Codebase MCP server supports two transport methods:

### 1. Standard Input/Output (stdio) - Default

This is the default transport method and is used when no transport is specified:

```bash
npx -y nia-codebase-mcp --api-key=YOUR_NIA_API_KEY --transport=stdio
```

### 2. Server-Sent Events (SSE)

To use SSE transport, specify the `--transport=sse` flag and optionally a port (default is 3000):

```bash
npx -y nia-codebase-mcp --api-key=YOUR_NIA_API_KEY --transport=sse --port=3000
```

## Usage in MCP Clients

### Cursor

1. Open Cursor Settings > Features > MCP Servers
2. Add a new MCP server
3. Name: `nia-codebase`
4. Type: `command`
5. Command: `npx -y nia-codebase-mcp --api-key=YOUR_NIA_API_KEY`

### Claude Desktop

Add to your Claude Desktop configuration at `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nia-codebase": {
      "command": "npx",
      "args": ["-y", "nia-codebase-mcp", "--api-key=YOUR_NIA_API_KEY"]
    }
  }
}
```

### Example Prompt

```
Using the lookup_codebase_context tool, search the codebase to understand how the chunking system works and explain its key components.
```

## Environment Variables

You can also configure the server using environment variables:

* `NIA_API_KEY`: Your Nia API key
* `TRANSPORT`: The transport method to use (`stdio` or `sse`)
* `PORT`: The port to use for SSE transport (default: 3000)
* `TOOL_TIMEOUT_MS`: Custom timeout for tool execution (default: 300000ms)
* `DEBUG`: Enable debug mode (`true` or `false`)

## Tools

This MCP server provides the following tool:

- **lookup_codebase_context**: Look up context from a codebase indexed in Nia, retrieving relevant code snippets based on user queries.

## License

MIT
