import { describe, expect, it } from "vitest";
import {
  EXAMPLE_PROJECT,
  exampleAppCards,
  exampleStatement,
  withExampleTrends,
} from "./wire";

describe("exampleStatement", () => {
  const statement = exampleStatement(EXAMPLE_PROJECT);

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
      expect(row.project).toBe(EXAMPLE_PROJECT);
      expect(row.application).toBeTruthy();
    }
  });
});

describe("withExampleTrends", () => {
  it("fills trend metrics on cards without them; backend fields win", () => {
    const { apps, filled } = withExampleTrends([
      {
        application: "real-app",
        metrics: { errorRate: 0.5, p95LatencyMs: 1200, chats24h: null },
      },
    ]);
    expect(filled).toBe(true);
    expect(apps[0].metrics?.errorRate).toBe(0.5); // real value kept
    expect(apps[0].metrics?.p95LatencyMs).toBe(1200); // real value kept
    expect(apps[0].metrics?.chats24h).toBeGreaterThan(0); // example filled
    expect(apps[0].metrics?.chatsHourly).toHaveLength(24); // example filled
    expect(apps[0].exampleFixture).toBe("goal-digger");
  });

  it("matches a known live app to its own fixture instead of array order", () => {
    const { apps } = withExampleTrends([
      { application: "playground-example", metrics: null },
      { application: "goal-digger", metrics: null },
    ]);
    expect(apps[0].exampleFixture).toBe("playground-example");
    expect(apps[0].metrics?.chats24h).toBe(9);
    expect(apps[1].exampleFixture).toBe("goal-digger");
    expect(apps[1].metrics?.chats24h).toBe(47);
  });

  it("leaves cards that already report live trend data untouched", () => {
    const app = { application: "live", metrics: { chats24h: 7 } };
    const { apps, filled } = withExampleTrends([app]);
    expect(filled).toBe(false);
    expect(apps[0]).toBe(app);
  });

  it("cycles fixture metric sets per card index", () => {
    const { apps } = withExampleTrends([{ metrics: null }, { metrics: null }]);
    expect(apps[0].metrics?.chats24h).not.toBe(apps[1].metrics?.chats24h);
  });
});

describe("exampleAppCards", () => {
  it("builds one complete card per fixture app", () => {
    const cards = exampleAppCards(EXAMPLE_PROJECT);
    expect(cards.length).toBeGreaterThanOrEqual(3);
    for (const card of cards) {
      expect(card.application).toBeTruthy();
      expect(card.exampleFixture).toBe(card.application);
      expect(card.project).toBe(EXAMPLE_PROJECT);
      expect(card.metrics.chats24h).not.toBeNull();
      expect(card.metrics.trendWindowSeconds).toBe(86_400);
    }
  });
});
