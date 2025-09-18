import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpTool, McpToolConfig, ReleaseState, Toolset, TelemetryService } from "@salesforce/mcp-provider-api";
import { getAllAllowedOrgs } from "../shared/auth.js";

const inputSchema = z.object({
  random_string: z.string().describe("Dummy parameter for no-parameter tools"),
});
type InputArgs = z.infer<typeof inputSchema>;
type InputArgsShape = typeof inputSchema.shape;
type OutputArgsShape = z.ZodRawShape;

export class SfDevopsListOrgs extends McpTool<InputArgsShape, OutputArgsShape> {
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
    return "sf-devopslist-orgs";
  }

  public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> {
    return {
      title: "List DevOps Orgs",
      description: `Lists all Salesforce orgs the user is currently authenticated with (logged into) on this machine. Useful for selecting which org to use for further operations. The output is a list of orgs with non-sensitive details such as username, instance URL, org ID, and org type.`,
      inputSchema: inputSchema.shape,
      outputSchema: undefined,
    };
  }

  public async exec(input: InputArgs): Promise<CallToolResult> {
    const orgs = await getAllAllowedOrgs();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(orgs, null, 2)
      }]
    };
  }
}