/**
 * MCP Server module exports.
 */

// Types
export type { McpResolvedWorkspace, McpErrorCode, McpError, IMcpServer } from "./types";
export type { IDisposable } from "../../shared/types";

// Workspace resolver
export { resolveWorkspace } from "./workspace-resolver";
export type { WorkspaceLookup } from "./workspace-resolver";

// MCP Server
export { McpServer, createDefaultMcpServer } from "./mcp-server";
export type { McpServerFactory } from "./mcp-server";

// MCP Server Manager
export { McpServerManager } from "./mcp-server-manager";
export type { McpServerManagerConfig } from "./mcp-server-manager";
