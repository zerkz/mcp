import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpTool, McpToolConfig, ReleaseState, Toolset, TelemetryService } from "@salesforce/mcp-provider-api";
import { checkoutWorkitemBranch } from "../checkoutWorkitemBranch.js";
import { fetchWorkItemByName } from "../getWorkItems.js";

const inputSchema = z.object({
  username: z.string().describe("The username of the DevOps Center org."),
  workItemName: z.string().min(1).describe("Exact Work Item Name to check out."),
  localPath: z.string().optional().describe("The directory path where the repository should be cloned/checked out. If not provided, ask user to provide the path where project is cloned.")
});
type InputArgs = z.infer<typeof inputSchema>;
type InputArgsShape = typeof inputSchema.shape;
type OutputArgsShape = z.ZodRawShape;

export class SfDevopsCheckoutWorkItem extends McpTool<InputArgsShape, OutputArgsShape> {
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
    return "checkout_workitem";
  }

  public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> {
    return {
      title: "Checkout Work Item",
      description: `Checks out the branch associated with a selected work item by name. Always ask the user to provide the local path (repoPath) to the checked-out repository. Takes the DevOps Center org username and the exact Work Item Name, looks up the Work Item to retrieve its repository URL and branch, and then checks out that branch.`,
      inputSchema: inputSchema.shape,
      outputSchema: undefined,
    };
  }

  public async exec(input: InputArgs): Promise<CallToolResult> {
    const workItem = await fetchWorkItemByName(input.username, input.workItemName);
    
    if (!workItem?.SourceCodeRepository?.repoUrl || !workItem?.WorkItemBranch) {
      return {
        content: [{
          type: "text",
          text: "Work item is missing required repository URL or branch information"
        }],
        isError: true
      };
    }
    
    const result = await checkoutWorkitemBranch({
      repoUrl: workItem.SourceCodeRepository.repoUrl,
      branchName: workItem.WorkItemBranch,
      localPath: input.localPath
    });
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    };
  }
}