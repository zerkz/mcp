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
import { McpTestClient, TransportFactory } from '@salesforce/mcp-test-client';
import { TestSession } from '@salesforce/cli-plugins-testkit';
import { z } from 'zod';
import { getUsernameParamsSchema } from '../../src/tools/sf-get-username.js';
import path from 'node:path';

describe('sf-get-username', () => {
  // TODO: client name/version should be hardcoded in class
  const client = new McpTestClient({
    name: 'sf-get-username-e2e-test',
    version: '1.0.0',
    timeout: 600000,
  });

  let orgUsername: string;

  let testSession: TestSession;

  // TODO: simplify this, we only care about params metadata
  const getUsernameSchema = {
    name: z.literal('sf-get-username'),
    params: getUsernameParamsSchema,
  };

  before(async () => {
    testSession = await TestSession.create({
      project: {
        name: 'MyTestProject',
      },
      scratchOrgs: [{ edition: 'developer', setDefault: true }],
      devhubAuthStrategy: 'AUTO',
    });

    orgUsername = [...testSession.orgs.keys()][0];

    // Create stdio transport to start the MCP server
    const transport = TransportFactory.createStdio({
      command: 'node',
      args: [path.join(process.cwd(), '..', '..', '..', 'mcp', 'bin', 'run.js'), '-o', orgUsername, '--no-telemetry'],
    });

    await client.connect(transport);
  });

  after(async () => {
    if (client?.connected) {
      await client.disconnect();
    }
    if (testSession) {
      await testSession.clean();
    }
  });

  it('should resolve default org', async () => {
    const result = await client.callTool(getUsernameSchema, {
      name: 'sf-get-username',
      params: {
        defaultTargetOrg: true,
        directory: testSession.project.dir,
      },
    });

    expect(result.content.length).to.equal(1);
    expect(result.content[0].type).to.equal('text');
    expect(result.content[0].text).to.equal(`ALWAYS notify the user the following 3 (maybe 4) pieces of information:
1. If it is default target-org or target-dev-hub ('.key' on the config)
2. The value of '.location' on the config
3. The value of '.value' on the config
4. IF '.cached' IS TRUE, tell then we are using a cached value and if they have changed it, restart the MCP Server

- Full config: {
  "key": "target-org",
  "location": "Local",
  "value": "${orgUsername}",
  "path": "${path.join(testSession.project.dir, '.sf', 'config.json')}"
}

UNLESS THE USER SPECIFIES OTHERWISE, use this username for the "usernameOrAlias" parameter in future Tool calls.`);
  });

  it('should resolve default devhub', async () => {
    const result = await client.callTool(getUsernameSchema, {
      name: 'sf-get-username',
      params: {
        defaultTargetOrg: false,
        defaultDevHub: true,
        directory: testSession.project.dir,
      },
    });

    expect(result.content.length).to.equal(1);
    expect(result.content[0].type).to.equal('text');
    expect(result.content[0].text).to.equal(`ALWAYS notify the user the following 3 (maybe 4) pieces of information:
1. If it is default target-org or target-dev-hub ('.key' on the config)
2. The value of '.location' on the config
3. The value of '.value' on the config
4. IF '.cached' IS TRUE, tell then we are using a cached value and if they have changed it, restart the MCP Server

- Full config: {
  "key": "target-dev-hub",
  "location": "Local",
  "value": "${testSession.hubOrg.username}",
  "path": "${path.join(testSession.project.dir, '.sf', 'config.json')}"
}

UNLESS THE USER SPECIFIES OTHERWISE, use this username for the "usernameOrAlias" parameter in future Tool calls.`);
  });
});
