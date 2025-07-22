#!/usr/bin/env -S node --loader ts-node/esm --disable-warning=ExperimentalWarning

import { dirname } from 'node:path';
import { execute } from '@oclif/core';

await execute({
  development: true,
  dir: import.meta.url,
  loadOptions: {
    root: dirname(import.meta.dirname),
    pjson: {
      name: 'mcp-test',
      version: '1.0.0',
      oclif: {
        bin: 'mcp-test',
        dirname: 'mcp-test',
        commands: './lib/commands',
        topicSeparator: ' ',
      },
    },
  },
});
