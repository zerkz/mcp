/*
 * Copyright 2025, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { McpServer, RegisteredTool, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult, Implementation, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { ServerOptions } from '@modelcontextprotocol/sdk/server/index.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { Telemetry } from './telemetry.js';

type ToolMethodSignatures = {
  tool: McpServer['tool'];
};

/**
 * A server implementation that extends the base MCP server with telemetry capabilities.
 *
 * The method overloads for `tool` are taken directly from the source code for the original McpServer. They're
 * copied here so that the types don't get lost.
 *
 * @extends {McpServer}
 */
export class SfMcpServer extends McpServer implements ToolMethodSignatures {
  /** Optional telemetry instance for tracking server events */
  private telemetry?: Telemetry;

  /**
   * Creates a new SfMcpServer instance
   *
   * @param {Implementation} serverInfo - The server implementation details
   * @param {ServerOptions & { telemetry?: Telemetry }} [options] - Optional server configuration including telemetry
   */
  public constructor(serverInfo: Implementation, options?: ServerOptions & { telemetry?: Telemetry }) {
    super(serverInfo, options);
    this.telemetry = options?.telemetry;
  }

  public tool: McpServer['tool'] = (name: string, ...rest: unknown[]): RegisteredTool => {
    // Given the signature of the tool function, the last argument is always the callback
    const cb = rest[rest.length - 1] as ToolCallback;

    const wrappedCb = async (args: RequestHandlerExtra<ServerRequest, ServerNotification>): Promise<CallToolResult> => {
      const startTime = Date.now();
      const result = await cb(args);
      const runtimeMs = Date.now() - startTime;

      this.telemetry?.sendEvent('MCP_SERVER_TOOL_CALLED', {
        name,
        runtimeMs,
      });

      if (result.isError) {
        this.telemetry?.sendEvent('MCP_SERVER_TOOL_ERROR', {
          name,
          runtimeMs,
        });
      }

      return result;
    };

    // @ts-expect-error because we no longer know what the type of rest is
    return super.tool(name, ...rest.slice(0, -1), wrappedCb);
  };
}
