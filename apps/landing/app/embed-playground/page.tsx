// For Mintlify iframe embed — zero chrome, bare PlaygroundConfigurator
// Supports ?embed=true param for compact iframe layout
// Theme follows system prefers-color-scheme via CSS light-dark()

import { PlaygroundConfigurator } from "@/content/components/playground/playground-configurator";

export const metadata = {
  title: "Playground — Aomi",
  description: "Interactively configure the AomiFrame widget and copy the generated code.",
  robots: { index: false },
};

export default async function EmbedPlaygroundPage(props: {
  searchParams: Promise<{ embed?: string }>;
}) {
  const { embed } = await props.searchParams;
  const isEmbed = embed === "true";

  return (
    <div
      className="embed-playground-root"
      style={
        isEmbed
          ? { width: "100%", minHeight: "80vh" }
          : { width: "100vw", height: "100vh", overflow: "auto" }
      }
    >
      <PlaygroundConfigurator forceEmbed={isEmbed} />
      <style>{`
        /* Aomi brand roles (aomi-design inventory: cool neutral ramp, sky accent).
           These shadcn-named vars are what fumadocs' --color-fd-* aliases read,
           so setting them here rethemes every fd-* utility in the chrome. */
        .embed-playground-root {
          color-scheme: light dark;
          font-family: "Geist", ui-sans-serif, system-ui, sans-serif;
          background: light-dark(#fafafa, #09090b);
          --background: light-dark(#ffffff, #09090b);
          --foreground: light-dark(#09090b, #fafafa);
          --card: light-dark(#ffffff, #18181b);
          --card-foreground: light-dark(#09090b, #fafafa);
          --popover: light-dark(#ffffff, #202024);
          --popover-foreground: light-dark(#09090b, #fafafa);
          --primary: light-dark(#5288c2, #7facd6);
          --primary-foreground: light-dark(#ffffff, #09090b);
          --secondary: light-dark(#f4f4f5, #27272a);
          --secondary-foreground: light-dark(#09090b, #fafafa);
          --muted: light-dark(#f4f4f5, #202024);
          --muted-foreground: light-dark(#71717a, #a1a1aa);
          --accent: light-dark(#e2eef8, #28354a);
          --accent-foreground: light-dark(#416cac, #aecbe8);
          --destructive: light-dark(#c34255, #b8394a);
          --border: light-dark(#e4e4e7, #3f3f46);
          --input: light-dark(#e4e4e7, #3f3f46);
          --ring: light-dark(#5288c2, #7facd6);
          --radius: 0.625rem;
          /* inventory roles with no shadcn equivalent */
          --surface-2: light-dark(#f4f4f5, #2e2e33);
          --accent-strong: light-dark(#416cac, #5288c2);
          --on-accent: light-dark(#ffffff, #09090b);
          /* fumadocs' fd aliases resolve var(--primary) at :root (registered
             properties inherit computed values), so re-declare them here to pick
             up the brand roles above. */
          --color-fd-background: var(--background);
          --color-fd-foreground: var(--foreground);
          --color-fd-muted: var(--muted);
          --color-fd-muted-foreground: var(--muted-foreground);
          --color-fd-popover: var(--popover);
          --color-fd-popover-foreground: var(--popover-foreground);
          --color-fd-card: var(--card);
          --color-fd-card-foreground: var(--card-foreground);
          --color-fd-border: var(--border);
          --color-fd-primary: var(--primary);
          --color-fd-primary-foreground: var(--primary-foreground);
          --color-fd-secondary: var(--secondary);
          --color-fd-secondary-foreground: var(--secondary-foreground);
          --color-fd-accent: var(--accent);
          --color-fd-accent-foreground: var(--accent-foreground);
          --color-fd-ring: var(--ring);
        }
      `}</style>
    </div>
  );
}
