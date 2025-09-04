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
import path from 'node:path';
import { queryOrgParamsSchema } from '../../src/tools/sf-query-org.js';

describe('sf-query-org', () => {
  const client = new McpTestClient({
    name: 'sf-query-org-e2e-test',
    version: '1.0.0',
    timeout: 120000 // 2 minutes for query operations
  });

  let testSession: TestSession;
  let orgUsername: string;

  const queryOrgSchema = {
    name: z.literal('sf-query-org'),
    params: queryOrgParamsSchema
  };

  before(async () => {
    try {
      testSession = await TestSession.create({
        project: { gitClone: 'https://github.com/trailheadapps/dreamhouse-lwc' },
        scratchOrgs: [{ setDefault: true, config: path.join('config', 'project-scratch-def.json') }],
        devhubAuthStrategy: 'AUTO',
      });

      orgUsername = [...testSession.orgs.keys()][0];
      console.log('dreamhouse project cloned and scratch org created!');
      console.log(`username: ${orgUsername}`);

      // Create stdio transport to start the MCP server
      const transport = TransportFactory.createStdio({
        command: 'node',
        args: [path.join(process.cwd(), '..', '..', '..', 'mcp', 'bin', 'run.js'), '-o', orgUsername, '--no-telemetry'],
      });

      await client.connect(transport);
    } catch (error) {
      console.error('Setup failed:', error);
      throw error;
    }
  });

  after(async () => {
    if (client.connected) {
      await client.disconnect();
    }
    if (testSession) {
      await testSession.clean();
    }
  });

  it('should query standard objects using regular API', async () => {
    const result = await client.callTool(queryOrgSchema, {
      name: 'sf-query-org',
      params: {
        query: 'SELECT Id, Name FROM User LIMIT 5',
        usernameOrAlias: orgUsername,
        directory: testSession.project.dir,
        useToolingApi: false
      }
    });

    expect(result.content.length).to.equal(1);
    expect(result.content[0].type).to.equal('text');
    
    const responseText = result.content[0].text;
    expect(responseText).to.contain('SOQL query results:');
    
    // Parse the query result JSON
    // @ts-ignore
    const queryMatch = responseText.match(/SOQL query results:\s*({[\s\S]*})/);
    expect(queryMatch).to.not.be.null;
    
    const queryResult = JSON.parse(queryMatch![1]);
    expect(queryResult.totalSize).to.be.greaterThan(0);
    expect(queryResult.done).to.be.true;
    expect(queryResult.records).to.be.an('array');
    expect(queryResult.records.length).to.be.greaterThan(0);
    
    // Verify User records have expected fields
    const firstUser = queryResult.records[0];
    expect(firstUser).to.have.property('Id');
    expect(firstUser).to.have.property('Name');
  });

  it('should query metadata using Tooling API', async () => {
    const result = await client.callTool(queryOrgSchema, {
      name: 'sf-query-org',
      params: {
        query: 'SELECT Id, Name, NamespacePrefix FROM ApexClass LIMIT 5',
        usernameOrAlias: orgUsername,
        directory: testSession.project.dir,
        useToolingApi: true
      }
    });

    expect(result.content.length).to.equal(1);
    expect(result.content[0].type).to.equal('text');
    
    const responseText = result.content[0].text;
    expect(responseText).to.contain('SOQL query results:');
    
    // Parse the query result JSON
    // @ts-ignore
    const queryMatch = responseText.match(/SOQL query results:\s*({[\s\S]*})/);
    expect(queryMatch).to.not.be.null;
    
    const queryResult = JSON.parse(queryMatch![1]);
    expect(queryResult.done).to.be.true;
    expect(queryResult.records).to.be.an('array');
    
    // ApexClass records should have expected fields
    if (queryResult.records.length > 0) {
      const firstClass = queryResult.records[0];
      expect(firstClass).to.have.property('Id');
      expect(firstClass).to.have.property('Name');
    }
  });

  it('should handle invalid SOQL query gracefully', async () => {
    const result = await client.callTool(queryOrgSchema, {
      name: 'sf-query-org',
      params: {
        query: 'SELECT InvalidField FROM NonExistentObject',
        usernameOrAlias: orgUsername,
        directory: testSession.project.dir,
        useToolingApi: false
      }
    });

    expect(result.content.length).to.equal(1);
    expect(result.content[0].type).to.equal('text');
    
    const responseText = result.content[0].text;
    expect(responseText).to.contain('Failed to query org:');
    expect(result.isError).to.be.true;
  });

  it('should handle missing usernameOrAlias parameter', async () => {
    const result = await client.callTool(queryOrgSchema, {
      name: 'sf-query-org',
      params: {
        query: 'SELECT Id FROM User LIMIT 1',
        usernameOrAlias: '', // Empty username
        directory: testSession.project.dir
      }
    });

    expect(result.content.length).to.equal(1);
    expect(result.content[0].type).to.equal('text');
    
    const responseText = result.content[0].text;
    expect(responseText).to.contain('The usernameOrAlias parameter is required');
    expect(responseText).to.contain('#sf-get-username tool');
    expect(result.isError).to.be.true;
  });
});
