import { NextResponse } from "next/server";
import { checkPlatformHealth, resetPlatformHealthCache } from "@/lib/ai/platform-health";
import { providerOrder } from "@/lib/ai/config";
import {
  deleteProviderKey,
  isKeyedProvider,
  providerKeyLabel,
  providerKeyStatus,
  saveProviderKey,
  KEYED_PROVIDERS,
} from "@/lib/ai/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The provider-chain management route, backing /settings and the header badge.
 *
 * GET reports, per provider in chain order: reachability, routable models,
 * and — for the BYO-key providers — key presence and source ONLY. No key is
 * ever returned by any API route, logged, or echoed in an error (the
 * guarantees live in lib/ai/anthropic-key.ts and lib/ai/keys.ts).
 */
export async function GET() {
  const health = await checkPlatformHealth();
  const order = providerOrder();
  const byId = new Map(health.providers.map((p) => [p.id, p]));
  const providers = order.map((id) => {
    const status = byId.get(id);
    return {
      id,
      label:
        id === "devin"
          ? "Devin CLI"
          : id === "ollama"
            ? "Ollama (local)"
            : providerKeyLabel(id),
      reachable: status?.reachable ?? false,
      models: status?.models ?? [],
      keyed: isKeyedProvider(id),
      key: isKeyedProvider(id) ? providerKeyStatus(id) : null,
    };
  });
  const active = providers.find((p) => p.reachable && p.models.length > 0) ?? null;
  return NextResponse.json({
    reachable: health.reachable,
    active: active ? { provider: active.id, model: active.models[0] ?? null } : null,
    providers,
  });
}

/** POST { provider, key }: persist a provider's key to its local key file (mode 600). */
export async function POST(request: Request) {
  let body: { provider?: unknown; key?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const provider = typeof body.provider === "string" ? body.provider : "";
  if (!isKeyedProvider(provider)) {
    return NextResponse.json(
      { error: `Unknown keyed provider. Expected one of: ${KEYED_PROVIDERS.join(", ")}` },
      { status: 400 },
    );
  }
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) return NextResponse.json({ error: "An API key is required" }, { status: 400 });
  try {
    saveProviderKey(provider, key);
  } catch (err) {
    // Validation messages are static and never contain the key.
    const message = err instanceof Error ? err.message : "Could not save the API key";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  // A cached "unreachable" readiness result must not outlive the fix.
  resetPlatformHealthCache();
  return NextResponse.json({ provider, ...providerKeyStatus(provider) });
}

/** DELETE { provider }: remove that provider's stored key file (env vars are the operator's to unset). */
export async function DELETE(request: Request) {
  let body: { provider?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const provider = typeof body.provider === "string" ? body.provider : "";
  if (!isKeyedProvider(provider)) {
    return NextResponse.json({ error: "Unknown keyed provider" }, { status: 400 });
  }
  deleteProviderKey(provider);
  resetPlatformHealthCache();
  return NextResponse.json({ provider, ...providerKeyStatus(provider) });
}
