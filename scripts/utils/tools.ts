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

import { spawn } from 'node:child_process';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { printTable } from '@oclif/table';
import { colorize } from '@oclif/core/ux';
import { encode as encodeGPT4oMini } from 'gpt-tokenizer/model/gpt-4o-mini';
import { encode as encodeO3Mini } from 'gpt-tokenizer/model/o3-mini';
import { encode as encodeGPT4 } from 'gpt-tokenizer/model/gpt-4';
import { TABLE_STYLE } from './table.js';

export type InvocableTool = {
  name: string;
  function: {
    name: string;
    description: string | undefined;
    parameters: Tool['inputSchema'];
    annotations: Tool['annotations'];
  };
};

export const getToolsList = async (): Promise<InvocableTool[]> => {
  const toolsList: string = await new Promise<string>((resolve, reject) => {
    const child = spawn('npx', [
      '@modelcontextprotocol/inspector',
      '--cli',
      'node',
      'bin/run.js',
      '--orgs',
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
    tokensGPT4oMini: encodeGPT4oMini(JSON.stringify(tool)).length,
    tokensO3Mini: encodeO3Mini(JSON.stringify(tool)).length,
    tokensGPT4: encodeGPT4(JSON.stringify(tool)).length,
  }));
  toolsWithTokens.push({
    tool: colorize('bold', 'TOTAL'),
    tokensGPT4oMini: toolsWithTokens.reduce((acc, tool) => acc + tool.tokensGPT4oMini, 0),
    tokensO3Mini: toolsWithTokens.reduce((acc, tool) => acc + tool.tokensO3Mini, 0),
    tokensGPT4: toolsWithTokens.reduce((acc, tool) => acc + tool.tokensGPT4, 0),
  });

  printTable({
    title: 'Tools List',
    data: toolsWithTokens,
    columns: [
      'tool',
      { key: 'tokensGPT4oMini', name: 'GPT 4o Mini' },
      { key: 'tokensO3Mini', name: 'O3 Mini' },
      { key: 'tokensGPT4', name: 'GPT 4' },
    ],
    titleOptions: {
      color: 'yellowBright',
    },
    ...TABLE_STYLE,
  });

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
