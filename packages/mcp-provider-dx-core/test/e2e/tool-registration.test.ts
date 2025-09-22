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

import { expect } from 'chai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { DxMcpTransport } from '@salesforce/mcp-test-client';

describe('specific tool registration', () => {
  const client = new Client({
    name: 'sf-tools',
    version: '0.0.1',
  });

  before(async () => {
    const transport = DxMcpTransport({
      args: ['--orgs', 'ALLOW_ALL_ORGS', '--tools', 'run_soql_query, deploy_metadata', '--no-telemetry'],
    });

    await client.connect(transport);
  });

  after(async () => {
    await client.close();
  });

  it('should enable 2 tools', async () => {
    const initialTools = (await client.listTools()).tools.map((t) => t.name).sort();

    expect(initialTools.length).to.equal(4);
    expect(initialTools).to.deep.equal(['run_soql_query', 'deploy_metadata','get_username', 'resume_tool_operation'].sort());
  });
});
