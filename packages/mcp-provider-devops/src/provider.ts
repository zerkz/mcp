import { McpProvider, McpTool, Services } from "@salesforce/mcp-provider-api";
import { SfDevopsListOrgs } from "./tools/sfDevopsListOrgs.js";
import { SfDevopsListProjects } from "./tools/sfDevopsListProjects.js";
import { SfDevopsListWorkItems } from "./tools/sfDevopsListWorkItems.js";
import { SfDevopsPromoteWorkItem } from "./tools/sfDevopsPromoteWorkItem.js";
import { SfDevopsDetectConflict } from "./tools/sfDevopsDetectConflict.js";
import { SfDevopsResolveConflict } from "./tools/sfDevopsResolveConflict.js";
import { CheckCommitStatus } from "./tools/checkCommitStatus.js";
import { CreatePullRequest } from "./tools/createPullRequest.js";
import { SfDevopsCheckoutWorkItem } from "./tools/sfDevopsCheckoutWorkItem.js";
import { SfDevopsCommitWorkItem } from "./tools/sfDevopsCommitWorkItem.js";

/**
 * DevOps MCPProvider for DevOps tools and operations
 */
export class DevOpsMcpProvider extends McpProvider {
  // Must return a name for your McpProvider. It is recommended to make this match the class name
  public getName(): string {
    return "DevOpsMcpProvider";
  }

  // Must return a promise containing an array of the McpTool instances that you want to register
  public provideTools(services: Services): Promise<McpTool[]> {
    const telemetryService = services.getTelemetryService();
    return Promise.resolve([
      // Core DevOps tools (matching local_server.ts with original tool names)
      new SfDevopsListOrgs(telemetryService),
      new SfDevopsListProjects(telemetryService),
      new SfDevopsListWorkItems(telemetryService),
      new SfDevopsPromoteWorkItem(telemetryService),
      new SfDevopsDetectConflict(telemetryService),
      new SfDevopsResolveConflict(telemetryService),

      // Work item management tools
      new SfDevopsCheckoutWorkItem(telemetryService),
      new SfDevopsCommitWorkItem(telemetryService),

      // Git/Version control tools
      new CheckCommitStatus(telemetryService),
      new CreatePullRequest(telemetryService),
    ]);
  }

  // This DevOpsMcpProvider does not implement provideResources or providePrompts since the
  // main MCP server doesn't consume them yet.
}