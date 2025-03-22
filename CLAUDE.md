# Nia MCP Development Guide

## Build & Run Commands
- **Build**: `tsc`
- **Typecheck**: `tsc --noEmit`
- **Run**: `node dist/index.js --api-key=YOUR_KEY [--transport=stdio|sse] [--port=3000]`
- **Dev run**: `bun src/index.ts --api-key=YOUR_KEY [--transport=stdio|sse] [--port=3000]`

## Code Style Guidelines
- **Imports**: Use ES Module imports with .js extensions as required for Node.js ES modules
- **File organization**: Keep related functionality in single files; utility functions near their usage
- **Error handling**: Use try/catch blocks and proper error propagation with typed errors
- **Naming**: camelCase for variables/functions, PascalCase for classes/types
- **TypeScript**: Use strict mode and proper type annotations, avoid `any` types
- **Async code**: Use async/await consistently (not mixing with Promise.then)
- **Comments**: Add comments for complex logic and function documentation
- **Error logging**: Use console.error for operational errors, with detailed messages
- **Constants**: Declare reusable values as named constants at module level
- **Transport layer**: Abstract backend communication behind clean interfaces

## Environmental Variables
- `NIA_API_KEY`: Your Nia API key
- `TRANSPORT`: Transport method: stdio (default) or sse
- `PORT`: Port for SSE transport (default: 3000)