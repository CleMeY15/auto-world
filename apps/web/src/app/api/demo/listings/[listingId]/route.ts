import { createDemoProxyHandler, writeDemoProxyTelemetry } from "../../../../../demo/proxy.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = createDemoProxyHandler({ route: "detail", telemetry: writeDemoProxyTelemetry });
type Context = { readonly params: Promise<{ readonly listingId: string }> };
async function run(request: Request, context: Context): Promise<Response> { return handle(request, (await context.params).listingId); }
export function GET(request: Request, context: Context): Promise<Response> { return run(request, context); }
export function POST(request: Request, context: Context): Promise<Response> { return run(request, context); }
export function HEAD(request: Request, context: Context): Promise<Response> { return run(request, context); }
export function PUT(request: Request, context: Context): Promise<Response> { return run(request, context); }
export function PATCH(request: Request, context: Context): Promise<Response> { return run(request, context); }
export function DELETE(request: Request, context: Context): Promise<Response> { return run(request, context); }
export function OPTIONS(request: Request, context: Context): Promise<Response> { return run(request, context); }
