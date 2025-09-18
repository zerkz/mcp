import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpTool, McpToolConfig, ReleaseState, Toolset, TelemetryService } from "@salesforce/mcp-provider-api";
import { commitWorkItem } from "../commitWorkItem.js";

const inputSchema = z.object({
  doceHubUsername: z.string().describe("DevOps Center org username (required; list orgs and select if unknown)"),
  sandboxUsername: z.string().describe("Sandbox org username (required; list orgs and select if unknown)"),
  workItem: z.object({
    id: z.string().describe("Work item ID")
  }).describe("Work item object - only ID needed for commit"),
  commitMessage: z.string().describe("Commit message describing the changes (ask user for input)"),
  repoPath: z.string().optional().describe("Optional: Absolute path to the git repository root. Defaults to current working directory."),
  changes: z.array(z.object({
    fullName: z.string().describe("Full name of the metadata component"),
    type: z.string().describe("Type of the metadata component (e.g., 'ApexClass', 'CustomObject')"),
    operation: z.string().describe("Operation performed ('Add', 'Modify', 'Delete')")
  })).optional().describe("Optional: Pre-selected changes. If omitted, the tool will intersect Sandbox changes with local git changes automatically.")
});
type InputArgs = z.infer<typeof inputSchema>;
type InputArgsShape = typeof inputSchema.shape;
type OutputArgsShape = z.ZodRawShape;

export class SfDevopsCommitWorkItem extends McpTool<InputArgsShape, OutputArgsShape> {
  private readonly telemetryService: TelemetryService;

  constructor(telemetryService: TelemetryService) {
    super();
    this.telemetryService = telemetryService;
  }

  public getReleaseState(): ReleaseState {
    return ReleaseState.GA;
  }

  public getToolsets(): Toolset[] {
    return [Toolset.OTHER];
  }

  public getName(): string {
    return "commit_workitem";
  }

  public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> {
    return {
      title: "Commit Work Item",
      description: `**THIS IS NOT A STARTING TOOL. Follow mandatory workflow: 1) List orgs and select DevOps Center + Sandbox 2) Select work item 3) Verify user is on correct branch 4) Ask user to deploy to Sandbox first 5) Ask for commit message 6) Run this tool. Commits changes to a work item in DevOps Center.`,
      inputSchema: inputSchema.shape,
      outputSchema: undefined,
    };
  }

  public async exec(input: InputArgs): Promise<CallToolResult> {
    const { randomUUID } = require('crypto');
    const requestId = randomUUID();
    
    const result = await commitWorkItem({
      doceHubUsername: input.doceHubUsername,
      sandboxUsername: input.sandboxUsername,
      workItem: input.workItem,
      requestId: requestId,
      commitMessage: input.commitMessage,
      repoPath: input.repoPath,
      changes: input.changes || []
    });
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    };
  }
}