import { createDemoProxyHandler, writeDemoProxyTelemetry } from "../../../../../demo/proxy.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = createDemoProxyHandler({ route: "catalog", schemaVersion: 2, telemetry: writeDemoProxyTelemetry });
export function GET(request: Request): Promise<Response> { return handle(request); }
export function POST(request: Request): Promise<Response> { return handle(request); }
export function HEAD(request: Request): Promise<Response> { return handle(request); }
export function PUT(request: Request): Promise<Response> { return handle(request); }
export function PATCH(request: Request): Promise<Response> { return handle(request); }
export function DELETE(request: Request): Promise<Response> { return handle(request); }
export function OPTIONS(request: Request): Promise<Response> { return handle(request); }
