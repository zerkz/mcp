import { TelemetryService } from "@salesforce/mcp-provider-api"
import { CodeAnalyzer, EngineTelemetryEvent, EventType, TelemetryEvent } from "@salesforce/code-analyzer-core";

export interface TelemetryListener {
    listen(codeAnalyzer: CodeAnalyzer): void
}


export class NoOpTelemetryListener implements TelemetryListener {

    public listen(_codeAnalyzer: CodeAnalyzer): void {
        // DELIBERATE NO-OP
    }
}

export class TelemetryListenerImpl implements TelemetryListener {

    public constructor(_telemetryService: TelemetryService) {
    }

    public listen(codeAnalyzer: CodeAnalyzer): void {
        codeAnalyzer.onEvent(EventType.TelemetryEvent, (e: TelemetryEvent) => this.handleEvent())
        codeAnalyzer.onEvent(EventType.EngineTelemetryEvent, (e: EngineTelemetryEvent) => this.handleEvent())
    }

    private handleEvent(): void {
        // TODO: DELIBERATE NO-OP
    }
}