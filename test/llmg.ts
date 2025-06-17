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

const API_KEY = process.env.SF_LLMG_API_KEY;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

if (!API_KEY) {
  throw new Error('SF_LLMG_API_KEY is not set');
}

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { printTable } from '@oclif/table';
import { stdout } from '@oclif/core/ux';
import yaml from 'yaml';

import { Command, Flags, flush, handle } from '@oclif/core';
type InvocableTool = {
  name: string;
  function: {
    name: string;
    description: string | undefined;
    parameters: Tool['inputSchema'];
  };
};

type GatewayResponse = {
  generation_details: {
    generations: Array<{
      content: string;
      tool_invocations: Array<{
        function: {
          name: string;
          arguments: string;
        };
      }>;
    }>;
  };
};

/**
 * Approximates token count for a JSON object using a simple algorithm.
 * This is a rough approximation and may not match exact token counts from specific LLMs.
 *
 * For comparison, here are the token counts:
 *
 * | Tool                  | OpenAI | countTokens |
 * |----------------------|---------|-------------|
 * | sf-get-username      | 632     | 702         |
 * | sf-list-all-orgs     | 262     | 283         |
 * | sf-query-org         | 405     | 416         |
 * | sf-assign-permission | 609     | 631         |
 * | sf-deploy-metadata   | 779     | 809         |
 * | sf-retrieve-metadata | 551     | 592         |
 *
 * @param obj - The JSON object to count tokens for
 * @returns Approximate number of tokens
 */
function countTokens(obj: unknown): number {
  // Convert object to string representation
  const jsonStr = JSON.stringify(obj);

  // Split into words and count
  const words = jsonStr.split(/\s+/);

  // Count tokens (rough approximation)
  let tokenCount = 0;
  for (const word of words) {
    // Each word is roughly 1.3 tokens
    tokenCount += Math.ceil(word.length / 4);

    // Add tokens for special characters
    tokenCount += (word.match(/[{}[\],:]/g) ?? []).length;
  }

  return tokenCount;
}

const getToolsList = async (): Promise<InvocableTool[]> => {
  const toolsList: string = await new Promise<string>((resolve, reject) => {
    const child = spawn('npx', [
      'mcp-inspector',
      '--cli',
      'node',
      'bin/run.js',
      '-o',
      'DEFAULT_TARGET_ORG',
      '--method',
      'tools/list',
    ]);

    let output = '';

    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      reject(new Error(data.toString()));
    });

    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });
  });

  const parsedToolsList = JSON.parse(toolsList) as { tools: Tool[] };

  const toolsWithTokens = parsedToolsList.tools?.map((tool) => ({
    tool: tool.name,
    tokens: countTokens(tool),
  }));

  printTable({
    title: 'Tools List',
    data: toolsWithTokens,
    columns: ['tool', { key: 'tokens', name: 'Approximate Tokens' }],
    headerOptions: {
      formatter: 'capitalCase',
    },
  });
  stdout('Total tokens: ' + toolsWithTokens.reduce((acc, tool) => acc + tool.tokens, 0));

  return (parsedToolsList.tools ?? []).map((tool) => ({
    name: tool.name,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      annotations: tool.annotations,
    },
  }));
};

/**
 * Generates a response from the LLM Gateway API using the specified model.
 *
 * @param {string} model - The model identifier to use for generation (e.g., 'llmgateway__AzureOpenAIGPT4Omni')
 * @returns {Promise<unknown>} The parsed JSON response from the API
 * @throws {Error} If the API request fails or returns an error
 *
 * @see {@link https://git.soma.salesforce.com/pages/tech-enablement/einstein/docs/gateway/get-started/#make-your-first-gateway-request} Make Your First Gateway Request Documentation
 * @see {@link https://git.soma.salesforce.com/pages/tech-enablement/einstein/docs/gateway/models-and-providers/} Models and Providers Documentation
 * @see {@link https://git.soma.salesforce.com/pages/tech-enablement/einstein/docs/gateway/apis/rest/#operation/chatMessages} REST API Documentation
 * @see {@link https://git.soma.salesforce.com/pages/tech-enablement/einstein/docs/gateway/function-calling/} Function Calling Documentation
 * @see {@link https://git.soma.salesforce.com/pages/tech-enablement/einstein/docs/gateway/get-started/auth/#api-key-limitations} API Key Authentication Documentation
 */
const makeGatewayRequest = async (
  prompt: string,
  model: string,
  tools: InvocableTool[]
): Promise<{ model: string; response: GatewayResponse }> => {
  const response = await fetch(
    'https://bot-svc-llm.sfproxy.einsteintest1.test1-uswest2.aws.sfdc.cl/v1.0/chat/generations',
    {
      method: 'POST',
      headers: {
        Authorization: `API_KEY ${API_KEY}`,
        'Content-Type': 'application/json',
        // We need to figure out which tenant, context, and feature id to use
        // Maybe this is something that will be given to us once the client registration completes???
        'x-sfdc-core-tenant-id': 'core/prod1/00DDu0000008cuqMAA',
        'x-sfdc-app-context': 'EinsteinGPT',
        'x-client-feature-id': 'EinsteinDocsAnswers',
      },
      body: JSON.stringify({
        model,
        tools,
        tool_config: {
          mode: 'auto',
        },
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        generation_settings: {
          max_tokens: 500,
          temperature: 0.5,
          parameters: {},
        },
      }),
    }
  );

  return {
    response: (await response.json()) as GatewayResponse,
    model,
  };
};

async function compareModelOutputs(prompt: string, models: string[], tools: InvocableTool[]) {
  const responses = await Promise.all(models.map((model) => makeGatewayRequest(prompt, model, tools)));

  printTable({
    title: `Prompt: ${prompt}`,
    data: responses.map((response) => ({
      model: response.model,
      response: response.response.generation_details.generations[0].content,
      tool: response.response.generation_details.generations[0].tool_invocations[0].function.name,
      arguments: Object.entries(
        JSON.parse(
          response.response.generation_details.generations[0].tool_invocations[0].function.arguments
        ) as Record<string, string>
      )
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n'),
    })),
    columns: ['model', 'response', 'tool', 'arguments'],
    headerOptions: {
      formatter: 'capitalCase',
    },
    overflow: 'wrap',
  });
}

export default class LLMGatewayTest extends Command {
  public static id = 'llm-gateway-test';
  public static summary = 'Test the MCP server against the LLM Gateway API';
  public static description = `Tests that the MCP server tools are accurately invoked by various LLM models.

Configuration:
- Uses a YAML file (default: llmg-test.yml) to specify models and test prompts
- Override the YAML file using the --file flag
- Requires SF_LLMG_API_KEY environment variable

For available models, see:
https://git.soma.salesforce.com/pages/tech-enablement/einstein/docs/gateway/models-and-providers/`;

  public static flags = {
    file: Flags.file({
      summary: 'The YAML file to use for the response',
      description: 'Must contain array of models and prompts',
      default: 'llmg-test.yml',
      exists: true,
      char: 'f',
    }),
    help: Flags.help({
      description: 'Show help',
      char: 'h',
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(LLMGatewayTest);

    const yamlContents = await fs.readFile(flags.file, 'utf8');
    const yamlObj = yaml.parse(yamlContents) as {
      models?: string[];
      prompts?: string[];
    };

    if (!yamlObj.models) {
      throw new Error('models is required');
    }

    if (!yamlObj.prompts) {
      throw new Error('prompts is required');
    }

    stdout('Models:');
    yamlObj.models.forEach((model) => stdout(`  - ${model}`));

    stdout();
    stdout('Prompts:');
    yamlObj.prompts.forEach((prompt) => stdout(`  - ${prompt}`));

    stdout();
    const tools = await getToolsList();
    stdout();

    for (const prompt of yamlObj.prompts) {
      // eslint-disable-next-line no-await-in-loop
      await compareModelOutputs(prompt, yamlObj.models, tools);
    }
  }
}

LLMGatewayTest.run(process.argv.slice(2), {
  root: dirname(import.meta.dirname),
  pjson: {
    name: 'llm-gateway-test',
    version: '0.0.1',
    oclif: {
      commands: {
        strategy: 'single',
        target: 'test/llmg.js',
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
