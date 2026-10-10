import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/screens/privacy/page";
export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy | Aomi Labs" },
      {
        name: "description",
        content:
          "Privacy Policy for Aomi Labs - how we collect, use, and protect your data.",
      },
    ],
  }),
  component: Screen,
});
