"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Example ToolUI Component
 *
 * This demonstrates how to create a custom UI for tool calls.
 * Replace this with your actual tool implementation.
 *
 * Usage:
 * 1. Define your tool args and result types
 * 2. Update toolName to match your backend tool
 * 3. Customize the render function with your UI
 * 4. Import and render <ExampleTool /> in your page
 */

// Define the shape of your tool's arguments
type ExampleToolArgs = {
  query: string;
  limit?: number;
};

// Define the shape of your tool's result
type ExampleToolResult = {
  data: Array<{
    id: string;
    title: string;
    description: string;
  }>;
  total: number;
};

export const ExampleTool = makeAssistantToolUI<
  ExampleToolArgs,
  ExampleToolResult
>({
  // IMPORTANT: Must match the tool name from your backend exactly!
  toolName: "example_tool",

  render: function ExampleToolUI({ args, argsText, result, status }) {
    return (
      <div className="my-4">
        {/* Show the tool call */}
        <pre className="text-muted-foreground mb-2 text-xs">
          example_tool({argsText})
        </pre>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {status.type === "running" ? "Searching..." : "Search Results"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Loading state */}
            {status.type === "running" && (
              <div className="flex items-center gap-2">
                <div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
                <span className="text-sm">
                  Searching for &quot;{args.query}&quot;...
                </span>
              </div>
            )}

            {/* Results */}
            {result && (
              <div className="space-y-3">
                <p className="text-muted-foreground text-sm">
                  Found {result.total} results
                  {args.limit && ` (showing top ${args.limit})`}
                </p>

                <div className="space-y-2">
                  {result.data.map((item) => (
                    <div
                      key={item.id}
                      className="hover:bg-muted/50 rounded-lg border p-3 transition-colors"
                    >
                      <h4 className="font-medium">{item.title}</h4>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {item.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error state (if your result includes error) */}
            {status.type === "incomplete" && (
              <div className="text-destructive text-sm">
                Failed to complete the search
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  },
});
