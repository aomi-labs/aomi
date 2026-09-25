"use client";

// Page-level explainer for the Telegram integration: numbered steps on the
// left, a Telegram-styled mock of the real BotFather /setcommands exchange on
// the right. Ported from the /mock-integration design session.

import { BadgeCheck, Bot, Copy, ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@build/lib/utils";

/** The /setcommands list we tell builders to paste into BotFather: exactly
 *  the commands the bot handles itself (the Telegram crate's panels, and the
 *  reserved list the backend refuses as custom commands). Custom commands a
 *  builder adds to their bot are theirs to advertise. */
export function botfatherCommands(): string {
  return [
    "start - Start the bot",
    "help - Show what the bot can do",
    "app - View or switch the app this chat runs on",
    "wallet - Connect or manage wallet",
    "transactions - Review transactions",
    "sign - Sign a pending action",
  ].join("\n");
}

/** Mimics Telegram's dark chat with BotFather — deliberately hardcoded
 *  Telegram colors (not theme tokens) so it reads as a real chat screenshot
 *  in both light and dark mode. */
function BotFatherGuide({ commands }: { commands: string }) {
  const [copied, setCopied] = useState(false);

  const incoming =
    "w-fit max-w-[80%] rounded-2xl rounded-bl-md bg-[#182533] px-3.5 py-2 text-[#f5f5f5]";
  const outgoing =
    "ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-[#2b5278] px-3.5 py-2 text-[#f5f5f5]";

  return (
    <div className="overflow-hidden rounded-md bg-[#0e1621] text-xs">
      <div className="flex items-center gap-3 bg-[#17212b] px-4 py-2.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-[#3390ec]">
          <Bot className="size-4.5 text-white" aria-hidden />
        </span>
        <div>
          <div className="flex items-center gap-1 text-[13px] font-medium text-white">
            BotFather
            <BadgeCheck
              className="size-3.5 fill-[#3390ec] text-[#17212b]"
              aria-hidden
            />
          </div>
          <div className="text-[11px] text-[#6d7f8f]">bot</div>
        </div>
      </div>
      <div className="space-y-2 px-4 py-4">
        <div className={cn(outgoing, "font-mono")}>/setcommands</div>
        <div className={incoming}>
          Choose a bot to change the list of commands.
        </div>
        <div className={cn(outgoing, "font-mono")}>@your_bot</div>
        <div className={incoming}>
          OK. Send me a list of commands for your bot. Please use this format:
          <br />
          <span className="font-mono">command1 - Description</span>
        </div>
        <div className={cn(outgoing, "relative max-w-[85%] py-2.5")}>
          <pre className="font-mono text-[11px] leading-5">{commands}</pre>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(commands);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }}
            className="absolute -right-2 -top-2 flex h-6 items-center gap-1 rounded-full border border-[#26343f] bg-[#17212b] px-2 text-[10px] font-medium text-white hover:bg-[#1f2c38]"
          >
            <Copy className="size-2.5" aria-hidden />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className={incoming}>Success! Command list updated.</div>
      </div>
    </div>
  );
}

export function TelegramHowItWorks() {
  const steps: { title: ReactNode; body: ReactNode }[] = [
    {
      title: "Create a bot in BotFather",
      body: (
        <>
          In Telegram, message @BotFather, send /newbot, and copy the token it
          returns.{" "}
          <a
            href="https://core.telegram.org/bots#how-do-i-create-a-bot"
            target="_blank"
            rel="noreferrer"
            className="text-foreground inline-flex items-center gap-1 underline underline-offset-4"
          >
            BotFather guide
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </>
      ),
    },
    {
      title: "Register it here",
      body: "Paste the token, attach one or more of your apps, and pick the handover app. We verify the token with Telegram and activate the webhook automatically.",
    },
    {
      title: "Users just chat",
      body: "Anyone who messages your bot uses their own Aomi identity, wallets, and threads. New conversations start on the handover app; /app switches between attached apps.",
    },
    {
      title: "Users choose how their agent signs",
      body: "Users enable autonomous signing for their own wallet in the Aomi Wallet Mini App. Once they approve the one-time permit, the agent can trade without asking for each transaction.",
    },
    {
      title: "Optional: make slash commands visible",
      body: "Send /setcommands to BotFather as shown on the right, so commands like /wallet and /transactions autocomplete in Telegram.",
    },
  ];
  return (
    <section className="py-2">
      <div className="grid gap-10 lg:grid-cols-2">
        <div className="space-y-5">
          <h2 className="font-display text-foreground text-lg font-normal tracking-tight">
            How Telegram bots work with Aomi
          </h2>
          <ol className="space-y-5">
            {steps.map((step, index) => (
              <li key={index} className="flex gap-3">
                <span className="bg-accent text-accent-selected flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
                  {index + 1}
                </span>
                <div className="space-y-1 pt-0.5">
                  <div className="text-foreground text-[13px] font-medium">
                    {step.title}
                  </div>
                  <p className="text-dim text-xs leading-5">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <BotFatherGuide commands={botfatherCommands()} />
      </div>
    </section>
  );
}
