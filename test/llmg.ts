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
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { printTable } from '@oclif/table';
import { stdout } from '@oclif/core/ux';

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
    tokenCount += (word.match(/[{}[\],:]/g) || []).length;
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
    },
  }));
};

const tools = await getToolsList();

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
const generateResponse = async (
  prompt: string,
  model: string
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
        //   {
        //     type: 'function',
        //     function: {
        //       name: 'get_current_weather',
        //       description: 'Get the current weather in a given location.',
        //       parameters: {
        //         type: 'object',
        //         properties: {
        //           location: {
        //             type: 'string',
        //             description: 'The city and state, e.g. San Francisco, CA',
        //           },
        //           format: {
        //             type: 'string',
        //             enum: ['celsius', 'fahrenheit'],
        //             description: 'The temperature unit to use. Infer this from the users location.',
        //           },
        //         },
        //       },
        //     },
        //   },
        //   {
        //     name: 'sf-get-username',
        //     function: {
        //       name: 'sf-get-username',
        //       description:
        //         'Intelligently determines the appropriate username or alias for Salesforce operations.\n\nAGENT/LLM INSTRUCTIONS:\nUse this tool when uncertain which username/org a user wants for Salesforce operations.\nThis tool handles three distinct scenarios:\n\n1. When defaultTargetOrg=true: Fetches the default target org configuration\n   - Use when user says "for my default org" or "for my default target org"\n\n2. When defaultDevHub=true: Fetches the default dev hub configuration\n   - Use when user says "for my default dev hub" or "for my default target dev hub"\n\n3. When both are false (default): Uses suggestUsername to intelligently determine the appropriate org\n   - Use when user is vague and says something like "for my org" or doesn\'t specify\n\nEXAMPLE USAGE:\n- When user says "Do X for my org" → defaultTargetOrg=false, defaultDevHub=false\n- When user says "For my default org" → defaultTargetOrg=true\n- When user says "For my default dev hub" → defaultDevHub=true',
        //       parameters: {
        //         type: 'object',
        //         properties: {
        //           defaultTargetOrg: {
        //             type: 'boolean',
        //             default: false,
        //             description:
        //               'Try to find default org\nAGENT INSTRUCTIONS:\nONLY SET TO TRUE when the user explicitly asks for the default org or default target org.\nLeave it as false when the user is vague and says something like "for my org" or "for my-alias".\n\nUSAGE EXAMPLE:\nGet username for my default org\n...for my default target org',
        //           },
        //           defaultDevHub: {
        //             type: 'boolean',
        //             default: false,
        //             description:
        //               'Try to find default dev hub\nAGENT INSTRUCTIONS:\nONLY SET TO TRUE when the user explicitly asks for the default dev hub or default target devhub.\nLeave it as false when the user is vague and says something like "for my org" or "for my-alias".\n\nUSAGE EXAMPLE:\nGet username for my default dev hub\n...for my default target dev hub\n...for my default devhub',
        //           },
        //           directory: {
        //             type: 'string',
        //             description:
        //               'The directory to run this tool from.\nAGENT INSTRUCTIONS:\nWe need to know where the user wants to run this tool from.\nLook at your current Workspace Context to determine this filepath.\nALWAYS USE A FULL PATH TO THE DIRECTORY.\nUnless the user explicitly asks for a different directory, or a new directory is created from the action of a tool, use this same directory for future tool calls.\n',
        //           },
        //         },
        //         required: ['directory'],
        //         additionalProperties: false,
        //         $schema: 'http://json-schema.org/draft-07/schema#',
        //       },
        //     },
        //   },
        // ],
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

async function displayModelResponses(prompt: string) {
  const responses = await Promise.all(models.map((model) => generateResponse(prompt, model)));

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

const models = [
  'llmgateway__OpenAIGPT35Turbo_01_25',
  'llmgateway__OpenAIGPT4OmniMini',
  'llmgateway__BedrockAnthropicClaude4Sonnet',
];

const prompts = [
  "What's my salesforce username?",
  'List all my orgs',
  'Deploy my project (~/my-project) using the my-sf-org alias',
];

stdout();
for (const prompt of prompts) {
  // eslint-disable-next-line no-await-in-loop
  await displayModelResponses(prompt);
}
