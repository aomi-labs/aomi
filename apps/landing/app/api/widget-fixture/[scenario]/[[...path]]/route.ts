import type { NextRequest } from "next/server";
import {
  resolveWidgetFixture,
  type WidgetFixture,
  type WidgetFixtureKey,
} from "../../../../_marketing/products/widget/fixture-data";

export const dynamic = "force-dynamic";

const timestamp = "2026-08-21T04:00:00.000Z";

type RouteContext = {
  params: Promise<{ scenario: string; path?: string[] }>;
};

function fixtureMessages(fixture: WidgetFixture) {
  return [
    { sender: "user", content: fixture.prompt, timestamp },
    ...fixture.steps.map((step) => ({
      sender: "agent",
      content: "",
      timestamp,
      tool_name: step.name,
      tool_arguments: step.arguments,
      tool_result: [step.topic, JSON.stringify(step.result)] as [
        string,
        string,
      ],
    })),
    ...(fixture.answer
      ? [{ sender: "agent", content: fixture.answer, timestamp }]
      : []),
  ];
}

function fixtureState(key: WidgetFixtureKey, fixture: WidgetFixture) {
  const threadId = `widget-fixture-${key}`;
  return {
    title: fixture.title,
    messages: fixtureMessages(fixture),
    system_events: [],
    is_processing: fixture.processing ?? false,
    thread_id: threadId,
    session_id: threadId,
    fixture: key,
  };
}

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const [key, fixture] = resolveWidgetFixture(params.scenario);
  const path = params.path?.join("/") ?? "";
  const state = fixtureState(key, fixture);
  const thread = {
    thread_id: state.thread_id,
    session_id: state.session_id,
    title: fixture.title,
    is_archived: false,
  };

  if (path === "api/thread/state") return json(state);
  if (path === "api/thread/apps") return json([]);
  if (path === "api/thread/models") return json(["gpt-5"]);
  if (path === "api/thread/events") return json([]);
  if (path === "api/widget/v1/signing-requests") return json([]);
  if (path === "api/threads") return json([thread]);
  if (path.startsWith("api/threads/")) return json(thread);
  if (path === "api/account")
    return json({ error: "fixture_anonymous" }, { status: 400 });

  if (path === "api/thread/updates") {
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  return json({ ok: true, scenario: fixture.scenario, fixture: key, path });
}

export async function POST(_request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const [key, fixture] = resolveWidgetFixture(params.scenario);
  const path = params.path?.join("/") ?? "";
  const state = fixtureState(key, fixture);

  if (path === "api/threads") {
    return json({
      thread_id: state.thread_id,
      session_id: state.session_id,
      title: fixture.title,
    });
  }
  if (path === "api/thread/model") {
    return json({
      success: true,
      rig: "gpt-5",
      baml: "fixture",
      created: false,
    });
  }
  if (path === "api/thread/chat" || path === "api/thread/interrupt") {
    return json(state);
  }
  if (path === "api/system") {
    return json({ res: { sender: "system", content: "fixture", timestamp } });
  }

  return json({ ok: true, scenario: fixture.scenario, fixture: key, path });
}
