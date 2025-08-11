# External Tool Parameters Pattern

This document explains how to handle parameters when creating external tools that integrate with the core MCP server.

## Problem Statement

When creating external tools that exist in separate NPM packages, we need to handle three types of parameters:

1. **Core-only parameters**: Used only in the tool setup (e.g., `directory`, `usernameOrAlias`)
2. **External-only parameters**: Used only by the external tool (e.g., `query`)
3. **Shared parameters**: Used by both core setup and external tool (e.g., `useToolingApi`)

The challenge is avoiding circular dependencies while allowing external tools to reference shared parameters defined in the core MCP server.

## Solution: Parameter Schema Mapping Pattern

Since external tools cannot import from the core MCP server (to avoid circular dependencies), we use a **Parameter Schema Mapping Pattern** where:

1. External tools define their own parameter schemas
2. Core MCP server maps shared parameters to external tool schemas
3. Core MCP server handles parameter validation and processing

### 1. External Tool Implementation

In your external tool (e.g., `external-tool-query-org.ts`):

```typescript
import { z } from 'zod';

// Define the parameter schema for this external tool
// Note: External tools should define their own parameter schemas to avoid circular dependencies
export const queryOrgParamsSchema = z.object({
  query: z.string().describe('SOQL query to run'),
  useToolingApi: z
    .boolean()
    .optional()
    .default(false)
    .describe('Use Tooling API for the operation (default is false).'),
});

export type ExternalQueryOrgParams = z.infer<typeof queryOrgParamsSchema>;

// Pure tool logic function
export const queryOrgExecutable = async (
  params: ExternalQueryOrgParams,
  connection: Connection
): Promise<CallToolResult> => {
  const { query, useToolingApi } = params;
  // ... implementation
};
```

### 2. Core MCP Server Tool Registration

In your core tool registration (e.g., `sf-query-org-using-external.ts`):

```typescript
import { directoryParam, usernameOrAliasParam, useToolingApiParam } from '../../shared/params.js';
import { queryOrgParamsSchema } from '../EXTERNAL/external-tool-query-org.js';

// Combine core parameters (used only in setup) with external tool parameters
// Note: We use the core's shared parameters for validation, but map them to the external tool's schema
export const queryOrgParamsSchema = z.object({
  // Core parameters (used only in tool setup)
  usernameOrAlias: usernameOrAliasParam,
  directory: directoryParam,
  // External tool parameters (passed through to external tool)
  query: queryOrgParamsSchema.shape.query,
  useToolingApi: useToolingApiParam, // Use core's shared parameter for validation
});

export const registerToolQueryOrg = (server: SfMcpServer): void => {
  server.tool(
    'sf-query-org',
    queryOrgDescription,
    queryOrgParamsSchema.shape,
    {
      title: 'Query Org',
      openWorldHint: false,
      readOnlyHint: true,
    },
    async ({ directory, usernameOrAlias, query, useToolingApi }) => {
      process.chdir(directory);
      const connection = await getConnection(usernameOrAlias);

      // Extract only the parameters that the external tool expects
      const passthroughParams = {
        query,
        useToolingApi,
      };

      return queryOrgExecutable(passthroughParams, connection);
    }
  );
};
```

## Parameter Categories

### 1. Core-only Parameters

- **Purpose**: Used only in the tool setup/registration
- **Examples**: `directory`, `usernameOrAlias`
- **Handling**: Defined in core MCP server, not passed to external tool

### 2. External-only Parameters

- **Purpose**: Used only by the external tool logic
- **Examples**: `query` (for SOQL queries)
- **Handling**: Defined in external tool, passed through from core

### 3. Shared Parameters

- **Purpose**: Used by both core setup and external tool
- **Examples**: `useToolingApi`
- **Handling**: Defined in both core MCP server and external tool, mapped during registration

## Benefits

1. **No Circular Dependencies**: External tools don't import from core MCP server
2. **Type Safety**: Full TypeScript support with proper type inference
3. **Clean Separation**: Core handles setup, external tools handle business logic
4. **Reusability**: Shared parameters can be used across multiple external tools
5. **Maintainability**: Clear separation of concerns

## Migration Guide

To migrate existing external tools to this pattern:

1. **Identify parameter types**: Categorize parameters as core-only, external-only, or shared
2. **Update external tool**: Define parameter schema locally (no imports from core)
3. **Update core registration**: Map shared parameters using core's shared parameter schemas
4. **Test thoroughly**: Ensure all parameters are properly passed through

## Example: Adding a New Shared Parameter

1. **Add to external tool**:

   ```typescript
   export const queryOrgParamsSchema = z.object({
     query: z.string().describe('SOQL query to run'),
     useToolingApi: z
       .boolean()
       .optional()
       .default(false)
       .describe('Use Tooling API for the operation (default is false).'),
     newSharedParam: z.string().describe('New shared parameter'),
   });
   ```

2. **Add to core shared params** (`src/shared/params.ts`):

   ```typescript
   export const newSharedParam = z.string().describe('New shared parameter');
   ```

3. **Update core registration**:
   ```typescript
   export const queryOrgParamsSchema = z.object({
     usernameOrAlias: usernameOrAliasParam,
     directory: directoryParam,
     query: queryOrgParamsSchema.shape.query,
     useToolingApi: useToolingApiParam,
     newSharedParam: newSharedParam, // Use core's shared parameter
   });
   ```

## Best Practices

1. **Keep external tools independent**: Don't import from core MCP server
2. **Use descriptive parameter names**: Make it clear what each parameter does
3. **Maintain consistency**: Use similar parameter schemas across related tools
4. **Document parameter purposes**: Add clear descriptions for all parameters
5. **Test parameter mapping**: Ensure shared parameters are correctly passed through
