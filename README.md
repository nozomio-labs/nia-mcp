```markdown
# Nia Model Context Protocol

The Nia Model Context Protocol server allows you to integrate with Nia's codebase understanding capabilities through function calling in tools like Cursor, Claude Desktop, and Windsurf.

## Setup

To run a Nia MCP server, you need:
1. A Nia API key (generate from the API Keys page)
2. The Project ID you want to use (found on your projects dashboard)

Run the following command:

```
# Replace with your actual Nia API key and project ID
npx -y @nia-ai/mcp --api-key=YOUR_NIA_API_KEY --project-id=YOUR_PROJECT_ID
```

## Transport Options

The Nia MCP server supports two transport methods:

### 1. Standard Input/Output (stdio) - Default

This is the default transport method and is used when no transport is specified:

```
npx -y @nia-ai/mcp --api-key=YOUR_NIA_API_KEY --project-id=YOUR_PROJECT_ID
```

### 2. Server-Sent Events (SSE)

To use SSE transport, specify the `--transport=sse` flag and optionally a port (default is 3000):

```
npx -y @nia-ai/mcp --api-key=YOUR_NIA_API_KEY --project-id=YOUR_PROJECT_ID --transport=sse --port=3000
```

## Usage in Cursor

### Stdio Mode (Recommended)

1. Open Cursor Settings > Features > MCP Servers
2. Add a new MCP server
3. Name: `nia-codebase`
4. Type: `command`
5. Command: `npx -y @nia-ai/mcp --api-key=YOUR_NIA_API_KEY --project-id=YOUR_PROJECT_ID`

### Example Prompt

```
Using the nia-codebase tool, search the codebase to understand how the chunking system works and explain its key components.
```

## Environment Variables

You can also configure the server using environment variables:

* `NIA_API_KEY`: Your Nia API key
* `NIA_PROJECT_ID`: The ID of your project 
* `TRANSPORT`: The transport method to use (`stdio` or `sse`)
* `PORT`: The port to use for SSE transport (default: 3000)
```# nia-mcp
