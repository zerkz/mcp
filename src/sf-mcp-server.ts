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
import {
  CallToolResult,
  Implementation,
  ServerNotification,
  ServerRequest,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import { ServerOptions } from '@modelcontextprotocol/sdk/server/index.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ZodRawShape } from 'zod';
import { Logger } from '@salesforce/core';
import { Telemetry } from './telemetry.js';

/**
 * A server implementation that extends the base MCP server with telemetry capabilities.
 *
 * The method overloads for `tool` are taken directly from the source code for the original McpServer. They're
 * copied here so that the types don't get lost.
 *
 * @extends {McpServer}
 */
export class SfMcpServer extends McpServer {
  private logger = Logger.childFromRoot('mcp-server');
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

  /**
   * Registers a zero-argument tool `name`, which will run the given function when the client calls it.
   */
  public tool(name: string, cb: ToolCallback): RegisteredTool;
  /**
   * Registers a zero-argument tool `name` (with a description) which will run the given function when the client calls it.
   */
  public tool(name: string, description: string, cb: ToolCallback): RegisteredTool;
  /**
   * Registers a tool taking either a parameter schema for validation or annotations for additional metadata.
   * This unified overload handles both `tool(name, paramsSchema, cb)` and `tool(name, annotations, cb)` cases.
   *
   * Note: We use a union type for the second parameter because TypeScript cannot reliably disambiguate
   * between ToolAnnotations and ZodRawShape during overload resolution, as both are plain object types.
   */
  public tool<Args extends ZodRawShape>(
    name: string,
    paramsSchemaOrAnnotations: Args | ToolAnnotations,
    cb: ToolCallback<Args>
  ): RegisteredTool;
  /**
   * Registers a tool `name` (with a description) taking either parameter schema or annotations.
   * This unified overload handles both `tool(name, description, paramsSchema, cb)` and
   * `tool(name, description, annotations, cb)` cases.
   *
   * Note: We use a union type for the third parameter because TypeScript cannot reliably disambiguate
   * between ToolAnnotations and ZodRawShape during overload resolution, as both are plain object types.
   */
  public tool<Args extends ZodRawShape>(
    name: string,
    description: string,
    paramsSchemaOrAnnotations: Args | ToolAnnotations,
    cb: ToolCallback<Args>
  ): RegisteredTool;
  /**
   * Registers a tool with both parameter schema and annotations.
   */
  public tool<Args extends ZodRawShape>(
    name: string,
    paramsSchema: Args,
    annotations: ToolAnnotations,
    cb: ToolCallback<Args>
  ): RegisteredTool;
  /**
   * Registers a tool with description, parameter schema, and annotations.
   */
  public tool<Args extends ZodRawShape>(
    name: string,
    description: string,
    paramsSchema: Args,
    annotations: ToolAnnotations,
    cb: ToolCallback<Args>
  ): RegisteredTool;

  /**
   * Registers a tool with the server and wraps its callback with telemetry tracking
   *
   * @param {string} name - The name of the tool to register
   * @param {...unknown[]} rest - Additional arguments for tool registration, with the last argument being the callback
   * @returns {RegisteredTool} The registered tool instance
   */
  public tool(name: string, ...rest: unknown[]): RegisteredTool {
    // Given the signature of the tool function, the last argument is always the callback
    const cb = rest[rest.length - 1] as ToolCallback;

    const wrappedCb = async (args: RequestHandlerExtra<ServerRequest, ServerNotification>): Promise<CallToolResult> => {
      this.logger.debug(`Tool ${name} called`);
      const startTime = Date.now();
      const result = await cb(args);
      const runtimeMs = Date.now() - startTime;

      this.logger.debug(`Tool ${name} completed in ${runtimeMs}ms`);

      this.telemetry?.sendEvent('MCP_SERVER_TOOL_CALLED', {
        name,
        runtimeMs,
      });

      if (result.isError) {
        this.logger.debug(`Tool ${name} errored`);
        this.telemetry?.sendEvent('MCP_SERVER_TOOL_ERROR', {
          name,
          runtimeMs,
        });
      }

      return result;
    };

    // @ts-expect-error because we no longer know what the type of rest is
    return super.tool(name, ...rest.slice(0, -1), wrappedCb);
  }
}
