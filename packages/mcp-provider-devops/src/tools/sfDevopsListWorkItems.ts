import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpTool, McpToolConfig, ReleaseState, Toolset, TelemetryService } from "@salesforce/mcp-provider-api";
import { fetchWorkItems } from "../getWorkItems.js";

const inputSchema = z.object({
  username: z.string().describe("Username of the DevOps Center org"),
  project: z.object({
    Id: z.string().describe("Selected project's Id"),
    Name: z.string().optional()
  }).describe("DevOps project selected from list_projects for the same org"),
});
type InputArgs = z.infer<typeof inputSchema>;
type InputArgsShape = typeof inputSchema.shape;
type OutputArgsShape = z.ZodRawShape;

export class SfDevopsListWorkItems extends McpTool<InputArgsShape, OutputArgsShape> {
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
    return "list_workitems";
  }

  public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> {
    return {
      title: "List DevOps Work Items",
      description: `Lists work items from a Salesforce DevOps Center project. Before using this tool, confirm the selected org is the DevOps Center org and select a project from list_projects. Each work item includes branch, environment, and repository details needed for checkout and promotion.`,
      inputSchema: inputSchema.shape,
      outputSchema: undefined,
    };
  }

  public async exec(input: InputArgs): Promise<CallToolResult> {
    const workItems = await fetchWorkItems(input.username, input.project.Id);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(workItems, null, 2)
      }]
    };
  }
}