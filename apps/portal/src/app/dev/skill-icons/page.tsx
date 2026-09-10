import { createElement } from "react";
import { notFound } from "next/navigation";
import { getSkillIcon } from "@/components/icons/skills";
import {
  skillIconSources,
  skillIconGenericAliases,
} from "@/components/icons/skills/source-manifest";

export const dynamic = "force-dynamic";
export default function SkillIconsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const ids = [
    ...Object.keys(skillIconSources),
    ...Object.keys(skillIconGenericAliases),
  ].sort();
  return (
    <main
      style={{ padding: 32, background: "#e9e9ec", fontFamily: "sans-serif" }}
    >
      <h1 style={{ color: "#17171a", fontSize: 24, marginBottom: 8 }}>
        Skill identities
      </h1>
      <p style={{ color: "#575760", marginBottom: 24 }}>
        All 42 built-in skills · actual components at 14, 20, and 32 pixels
      </p>
      {[false, true].map((dark) => (
        <section
          key={String(dark)}
          style={{
            background: dark ? "#19191d" : "#fff",
            color: dark ? "#ededf0" : "#242429",
            padding: 24,
            borderRadius: 16,
            marginBottom: 24,
          }}
        >
          <h2 style={{ fontSize: 16, marginBottom: 20 }}>
            {dark ? "Dark" : "Light"}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 20,
            }}
          >
            {ids.map((id) => (
              <div key={id} data-skill-id={id} style={{ minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    gap: 18,
                    alignItems: "center",
                    height: 40,
                  }}
                >
                  {[14, 20, 32].map((size) =>
                    createElement(getSkillIcon(id)!, {
                      key: size,
                      width: size,
                      height: size,
                      style: { flexShrink: 0 },
                    }),
                  )}
                </div>
                <p style={{ fontSize: 11, marginTop: 8 }}>{id}</p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
