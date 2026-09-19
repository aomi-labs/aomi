import { defineCommand } from "citty";
import { globalArgs, buildCliConfig } from "./shared";

const sessionListDef = defineCommand({
  meta: { name: "list", description: "List local sessions with metadata" },
  args: { ...globalArgs },
  async run({ args }) {
    const { sessionsCommand } = await import("../sessions");
    await sessionsCommand(buildCliConfig(args));
  },
});

const sessionNewDef = defineCommand({
  meta: {
    name: "new",
    description: "Start a fresh session and make it active",
  },
  args: { ...globalArgs },
  async run({ args }) {
    const { newSessionCommand } = await import("../sessions");
    newSessionCommand(buildCliConfig(args));
  },
});

const sessionResumeDef = defineCommand({
  meta: { name: "resume", description: "Resume a local session" },
  args: {
    id: {
      type: "positional",
      description: "Session ID or session-N",
      required: true,
    },
  },
  async run({ args }) {
    const { resumeSessionCommand } = await import("../sessions");
    await resumeSessionCommand(args.id);
  },
});

const sessionDeleteDef = defineCommand({
  meta: { name: "delete", description: "Delete a local session" },
  args: {
    id: {
      type: "positional",
      description: "Session ID or session-N",
      required: true,
    },
  },
  async run({ args }) {
    const { deleteSessionCommand } = await import("../sessions");
    deleteSessionCommand(args.id);
  },
});

const sessionStatusDef = defineCommand({
  meta: { name: "status", description: "Show current session state" },
  args: { ...globalArgs },
  async run({ args }) {
    const { statusCommand } = await import("../control");
    await statusCommand(buildCliConfig(args));
  },
});

const sessionLogDef = defineCommand({
  meta: { name: "log", description: "Show conversation history" },
  args: { ...globalArgs },
  async run({ args }) {
    const { logCommand } = await import("../history");
    await logCommand(buildCliConfig(args));
  },
});

const sessionEventsDef = defineCommand({
  meta: { name: "events", description: "List system events" },
  args: { ...globalArgs },
  async run({ args }) {
    const { eventsCommand } = await import("../control");
    await eventsCommand(buildCliConfig(args));
  },
});

const sessionInterruptDef = defineCommand({
  meta: { name: "interrupt", description: "Interrupt the active Agent turn" },
  args: { ...globalArgs },
  async run({ args }) {
    const { interruptCommand } = await import("../control");
    await interruptCommand(buildCliConfig(args));
  },
});

const sessionCloseDef = defineCommand({
  meta: { name: "close", description: "Close the current session" },
  args: { ...globalArgs },
  async run({ args }) {
    const { closeCommand } = await import("../history");
    closeCommand(buildCliConfig(args));
  },
});

export const sessionDef = defineCommand({
  meta: { name: "session", description: "Session management" },
  subCommands: {
    list: sessionListDef,
    new: sessionNewDef,
    resume: sessionResumeDef,
    delete: sessionDeleteDef,
    status: sessionStatusDef,
    log: sessionLogDef,
    events: sessionEventsDef,
    interrupt: sessionInterruptDef,
    close: sessionCloseDef,
  },
});
