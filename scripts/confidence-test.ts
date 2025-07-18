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

import { dirname } from 'node:path';
import { printTable } from '@oclif/table';
import { stdout, colorize } from '@oclif/core/ux';
import { Command, Flags, flush, handle } from '@oclif/core';
import { makeGatewayRequests } from './utils/gateway.js';
import { getToolsList, InvocableTool } from './utils/tools.js';
import { TABLE_STYLE } from './utils/table.js';
import { readYamlFile } from './utils/yaml.js';

const castToArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

async function compareModelOutputs(
  prompt: string | string[],
  models: string[],
  tools: InvocableTool[]
): Promise<Record<string, string[]>> {
  const prompts = castToArray(prompt);
  const responses = await Promise.all(models.map((model) => makeGatewayRequests(prompts, model, tools)));

  const invokedTools = responses.reduce<Record<string, string[]>>((acc, response) => {
    // eslint-disable-next-line no-param-reassign
    acc[response.model] = response.responses.flatMap(
      (r) => r.generation_details?.generations[0].tool_invocations?.[0]?.function.name ?? []
    );
    return acc;
  }, {});

  printTable({
    title: `${colorize('yellowBright', 'Prompt')}:\n  - ${prompts.join('\n  - ')}`,
    data: responses.map((response) => ({
      model: response.model,
      chat: response.messages.map((m) => `${colorize('bold', m.role)}: ${m.content}`).join('\n\n'),
      tools: response.responses
        .map((r, index) => {
          const toolInvocation = r.generation_details?.generations[0].tool_invocations?.[0];
          if (!toolInvocation) {
            return `Message ${index + 1}: No tool invoked`;
          }

          const toolArgs = JSON.parse(toolInvocation.function.arguments ?? '{}') as Record<string, string>;
          const argsString = Object.entries(toolArgs)
            .map(([key, value]) => `  - ${key}: ${value}`)
            .join('\n');

          return `Message ${index + 1}: ${colorize('bold', toolInvocation.function.name)}${
            argsString ? `\n${argsString}` : ''
          }`;
        })
        .join('\n\n'),
    })),
    columns: [
      { key: 'model', width: '30%' },
      { key: 'chat', width: '40%' },
      { key: 'tools', width: '30%', name: 'Tool Invocations' },
    ],
    width: process.stdout.columns,
    ...TABLE_STYLE,
  });

  return invokedTools;
}

export default class ConfidenceTest extends Command {
  public static id = 'confidence-test';
  public static summary = 'Test the MCP server against the LLM Gateway API';
  public static description = `Tests that the MCP server tools are accurately invoked by various LLM models.

Configuration:
- Uses a YAML file (default: test-assets/compare-responses.yml) to specify models and test prompts
- Override the YAML file using the --file flag
- Requires SF_LLMG_API_KEY environment variable

YAML File Format:
The YAML file should contain:
- models: Array of model identifiers to test against
- prompts: Array of test prompts (can be strings or arrays of strings for multi-turn conversations)

Example YAML structure:
  expected-tool: sf-deploy-metadata
  models:
    - llmgateway__OpenAIGPT35Turbo_01_25
    - llmgateway__OpenAIGPT4OmniMini
  prompts:
    - "What's my salesforce username?"
    - ["I am a Salesforce developer", "Deploy my project"]
    - - I am a Salesforce developer.
      - Deploy my project

For available models, see:
https://git.soma.salesforce.com/pages/tech-enablement/einstein/docs/gateway/models-and-providers/`;

  public static flags = {
    file: Flags.file({
      summary: 'The YAML file to use for the response',
      description: 'Must contain array of models and prompts',
      default: 'test-assets/compare-responses.yml',
      exists: true,
      char: 'f',
    }),
    help: Flags.help({
      description: 'Show help',
      char: 'h',
    }),
    'confidence-level': Flags.integer({
      summary: 'Confidence level for the tool',
      description: 'If confidence level is below this value, command will fail',
      min: 0,
      max: 100,
      default: 50,
    }),
    runs: Flags.integer({
      summary: 'Number of runs to use for confidence level',
      description: 'If specified, will run the tool multiple times to determine confidence level',
      default: 5,
      char: 'r',
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(ConfidenceTest);

    const yamlObj = await readYamlFile<{
      'expected-tool': string;
      models: string[];
      prompts: Array<string | string[]>;
    }>(flags.file);

    if (!yamlObj.models?.length) {
      throw new Error('At least one model is required');
    }

    if (!yamlObj.prompts?.length) {
      throw new Error('At least one prompt is required');
    }

    if (!yamlObj['expected-tool']) {
      throw new Error('Expected tool is required in the YAML file');
    }

    stdout('Expected Tool:');
    stdout(`  - ${yamlObj['expected-tool']}`);

    stdout('Models:');
    yamlObj.models.forEach((model) => stdout(`  - ${model}`));

    stdout();
    stdout('Prompts:');
    yamlObj.prompts.forEach((prompt) => {
      if (Array.isArray(prompt)) {
        stdout(`  - - ${prompt.join('\n    - ')}`);
      } else {
        stdout(`  - ${prompt}`);
      }
    });

    stdout();
    const tools = await getToolsList({ verbose: true });
    stdout();

    const runLog: Record<string, Record<string, string[][]>> = {};

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _ of Array.from({ length: flags.runs })) {
      for (const prompt of yamlObj.prompts) {
        // eslint-disable-next-line no-await-in-loop
        const invokedTools = await compareModelOutputs(prompt, yamlObj.models, tools);
        const promptKey = Array.isArray(prompt) ? prompt.join(' ') : prompt;
        runLog[promptKey] = runLog[promptKey] || {};
        Object.entries(invokedTools).forEach(([model, iTools]) => {
          runLog[promptKey][model] = runLog[promptKey][model] || [];
          runLog[promptKey][model].push(iTools);
        });
      }
    }

    stdout();
    let pass = true;
    for (const [prompt, models] of Object.entries(runLog)) {
      const tableData = Object.entries(models).map(([model, runs]) => {
        const expectedToolCount = runs.flat().filter((tool) => tool === yamlObj['expected-tool']).length;
        const totalRuns = runs.length;
        const confidenceLevel = Math.round((expectedToolCount / totalRuns) * 100);

        if (confidenceLevel < flags['confidence-level']) {
          pass = false;
        }

        return {
          model,
          expectedTool: yamlObj['expected-tool'],
          invocations: `${expectedToolCount}/${totalRuns}`,
          actualInvocations: runs.map((r) => r.join(', ')).join('\n'),
          confidence: `${confidenceLevel}%`,
          status: confidenceLevel >= flags['confidence-level'] ? colorize('green', 'PASS') : colorize('red', 'FAIL'),
        };
      });

      printTable({
        title: `Results for prompt:\n${colorize('yellowBright', prompt)}`,
        data: tableData,
        columns: [
          { key: 'model', name: 'Model' },
          { key: 'expectedTool', name: 'Expected Tool Invocation' },
          { key: 'actualInvocations', name: 'Actual Tool Invocations' },
          { key: 'invocations', name: 'Invocation Count' },
          { key: 'confidence', name: 'Confidence' },
          { key: 'status', name: 'Status' },
        ],
        ...TABLE_STYLE,
      });
    }

    if (!pass) {
      throw new Error('Confidence level not met');
    }
  }
}

ConfidenceTest.run(process.argv.slice(2), {
  root: dirname(import.meta.dirname),
  pjson: {
    name: 'confidence-test',
    version: '0.0.1',
    oclif: {
      commands: {
        strategy: 'single',
        target: 'scripts/confidence-test.js',
      },
    },
  },
}).then(
  async () => {
    await flush();
  },
  async (err) => {
    await handle(err as Error);
  }
);
