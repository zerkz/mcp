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

/* eslint-disable no-console */

import { z } from 'zod';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Connection, Org, SfProject } from '@salesforce/core';
import { SourceTracking } from '@salesforce/source-tracking';
import { ComponentSet, ComponentSetBuilder } from '@salesforce/source-deploy-retrieve';
import { ensureString } from '@salesforce/ts-types';
import { Duration } from '@salesforce/kit';
import { directoryParam, usernameOrAliasParam } from '../shared/params.js';
import { textResponse } from '../shared/utils.js';
import { getConnection } from '../shared/auth.js';

/*
 * Deploy metadata to a Salesforce org.
 *
 * Parameters:
 * - TODO
 * - usernameOrAlias: username or alias for the Salesforce org to run the query against
 *
 * Returns:
 * - textResponse: Deploy response in json
 */

export const deployMetadataParams = z.object({
  sourceDir: z
    .array(z.string())
    .describe('Path to the local source files to deploy. Leave this unset if the user is vague about what to deploy.')
    .optional(),
  // `RunSpecifiedTests` is excluded on purpose because the tool sets this level when Apex tests to run are passed in.
  //
  // Can be left unset to let the org decide which test level to use:
  // https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_deploy_running_tests.htm
  //
  // TODO: improve desc. for each test level, user should be able to say:
  // * "deploy X and run tests in orgs expect ones from packages" -> "RunLocalTests"
  // * "deploy X and run all tests in orgs" -> "RunAllTestsInOrg"
  apexTestLevel: z
    .enum(['NoTestRun', 'RunLocalTests', 'RunAllTestsInOrg'])
    .describe(
      `Apex test level to use during deployment.

AGENT INSTRUCTIONS
Set this only if the user specifically ask to set a specific test level for the deployment, otherwise leave it unset.
Don't set this param is "apexTests" is also set.
`
    )
    .optional(),
  apexTests: z
    .array(z.string())
    .describe(
      `Apex tests classes to run.

Set this param if the user ask an Apex test to be run during deployment.
`
    )
    .optional(),
  usernameOrAlias: usernameOrAliasParam,
  directory: directoryParam,
});

export type DeployMetadata = z.infer<typeof deployMetadataParams>;

export const registerToolDeployMetadata = (server: McpServer): void => {
  server.tool(
    'sf-deploy-metadata',
    `Deploy metadata to an org from your local project.

AGENT INSTRUCTIONS:
If the user doesn't specify what to deploy exactly ("deploy my changes"), leave the "sourceDir" param empty so the tool calculates which files to deploy.

EXAMPLE USAGE:
Deploy changes to my org
Deploy this file to my org
Deploy X metadata to my org
Deploy X to my org and run A,B and C apex tests.
`,
    deployMetadataParams.shape,
    async ({ sourceDir, usernameOrAlias, apexTests, apexTestLevel, directory }) => {
      // TODO: check that apexTestLevel and apexTests aren't set at the same time.

      // TODO: documemnt why this is needed for STL
      process.chdir(directory);

      const connection = await getConnection(usernameOrAlias);
      const project = await SfProject.resolve(directory);

      const org = await Org.create({ connection });
      try {
        const stl = await SourceTracking.create({
          org,
          project,
          subscribeSDREvents: true,
        });

        const cset = await buildComponentSet(connection, project, stl, sourceDir);

        if (cset.size === 0) {
          return textResponse('No files to deploy found');
          // TODO: should be this an error? this is different from an org that doesn't do source-tracking
          // return textResponse('STL: no files to deploy found', true);
          // let filesOutput = ''
          // cset.getSourceComponents().toArray().forEach((cmp) => {
          //   filesOutput += `${cmp.type.name}:${cmp.fullName}\n`;
          // });
          // return textResponse(filesOutput)
        }

        const deploy = await cset.deploy({
          usernameOrConnection: connection,
          apiOptions: {
            ...(apexTests ? { runTests: apexTests, testLevel: 'RunSpecifiedTests' } : {}),
            ...(apexTestLevel ? { testLevel: apexTestLevel } : {}),
          },
        });

        const result = await deploy.pollStatus({
          // TODO: what'a good default for this?
          // Coding agents migth be deploy just a few files each turn so 5min is ok, not sure about full-project deploys and how we would handle timeouts.
          timeout: Duration.minutes(10),
        });

        return textResponse(`Deploy result: ${JSON.stringify(result.response)}`, !result.response.success);
        // }
      } catch (error) {
        console.error(error);
        return textResponse(`Failed to query org: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
      }
    }
  );
};

async function buildComponentSet(
  connection: Connection,
  project: SfProject,
  stl: SourceTracking,
  sourceDir?: string[]
): Promise<ComponentSet> {
  if (sourceDir) {
    return ComponentSetBuilder.build({
      apiversion: connection.getApiVersion(),
      sourceapiversion: ensureString((await project.resolveProjectConfig()).sourceApiVersion),
      sourcepath: sourceDir,
      projectDir: stl?.projectPath,
    });
  }

  const cs = (await stl.localChangesAsComponentSet(false))[0] ?? new ComponentSet(undefined, stl.registry);
  return cs;
}
