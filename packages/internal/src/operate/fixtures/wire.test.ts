import { describe, expect, it } from "vitest";
import { exampleAgentCards, exampleStatement, withExampleTrends } from "./wire";

const PROJECT = { id: 0, repositoryLink: "example/agents" };

describe("exampleStatement", () => {
  const statement = exampleStatement(PROJECT);

  it("folds the summary from entries like the manager's assemble_statement", () => {
    expect(statement.summary.grossRevenue).toBeCloseTo(183.25, 2);
    expect(statement.summary.platformFees).toBeCloseTo(28.33, 2);
    expect(statement.summary.serviceCharges).toBeCloseTo(41.9, 2);
    expect(statement.summary.net).toBeCloseTo(113.02, 2);
  });

  it("nets out: gross − fees − charges = net", () => {
    const { grossRevenue, platformFees, serviceCharges, net } =
      statement.summary;
    expect(grossRevenue - platformFees - serviceCharges).toBeCloseTo(net, 2);
  });

  it("sorts entries newest day first and stamps every row with the source", () => {
    const days = statement.entries.map((entry) => entry.day);
    expect([...days].sort((a, b) => b.localeCompare(a))).toEqual(days);
    for (const row of [
      ...statement.revenue,
      ...statement.charges,
      ...statement.entries,
    ]) {
      expect(row.project).toBe(PROJECT);
      expect(row.agent).toBeTruthy();
    }
  });
});

describe("withExampleTrends", () => {
  it("fills trend metrics on cards without them; backend fields win", () => {
    const { agents, filled } = withExampleTrends([
      {
        agent: "real-agent",
        metrics: { errorRate: 0.5, p95LatencyMs: 1200, chats24h: null },
      },
    ]);
    expect(filled).toBe(true);
    expect(agents[0].metrics?.errorRate).toBe(0.5); // real value kept
    expect(agents[0].metrics?.p95LatencyMs).toBe(1200); // real value kept
    expect(agents[0].metrics?.chats24h).toBeGreaterThan(0); // example filled
    expect(agents[0].metrics?.chatsHourly).toHaveLength(24); // example filled
    expect(agents[0].exampleFixture).toBe("goal-digger");
  });

  it("matches a known live agent to its own fixture instead of array order", () => {
    const { agents } = withExampleTrends([
      { agent: "playground-example", metrics: null },
      { agent: "goal-digger", metrics: null },
    ]);
    expect(agents[0].exampleFixture).toBe("playground-example");
    expect(agents[0].metrics?.chats24h).toBe(9);
    expect(agents[1].exampleFixture).toBe("goal-digger");
    expect(agents[1].metrics?.chats24h).toBe(47);
  });

  it("leaves cards that already report live trend data untouched", () => {
    const agent = { agent: "live", metrics: { chats24h: 7 } };
    const { agents, filled } = withExampleTrends([agent]);
    expect(filled).toBe(false);
    expect(agents[0]).toBe(agent);
  });

  it("cycles fixture metric sets per card index", () => {
    const { agents } = withExampleTrends([
      { metrics: null },
      { metrics: null },
    ]);
    expect(agents[0].metrics?.chats24h).not.toBe(agents[1].metrics?.chats24h);
  });
});

describe("exampleAgentCards", () => {
  it("builds one complete card per fixture agent", () => {
    const cards = exampleAgentCards(PROJECT);
    expect(cards.length).toBeGreaterThanOrEqual(3);
    for (const card of cards) {
      expect(card.agent).toBeTruthy();
      expect(card.exampleFixture).toBe(card.agent);
      expect(card.project).toBe(PROJECT);
      expect(card.metrics.chats24h).not.toBeNull();
      expect(card.metrics.trendWindowSeconds).toBe(86_400);
    }
  });
});
