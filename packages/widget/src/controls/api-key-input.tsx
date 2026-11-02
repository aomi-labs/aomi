"use client";

import { cn } from "@/lib/cn";
import { memo, useState, type FC } from "react";
import { KeyIcon, CheckIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useApiKey } from "@aomi-labs/react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/ui/dialog";

export type ApiKeyInputProps = {
  className?: string;
  title?: string;
  description?: string;
};

export const ApiKeyInput: FC<ApiKeyInputProps> = ({
  className,
  title = "App key",
  description = "Private Apps need a key. Enter the one the App's builder shared with you.",
}) => {
  // The control context changes during every turn; only the key matters here.
  const { state, actions } = useApiKey();
  return (
    <ApiKeyDialog
      className={className}
      title={title}
      description={description}
      hasApiKey={Boolean(state.apiKey)}
      setApiKey={actions.setApiKey}
    />
  );
};

const ApiKeyDialog = memo(function ApiKeyDialog({
  className,
  title,
  description,
  hasApiKey,
  setApiKey,
}: ApiKeyInputProps & {
  hasApiKey: boolean;
  setApiKey: (apiKey: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [showKey, setShowKey] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative rounded-full", className)}
          aria-label={hasApiKey ? "App key configured" : "Set App key"}
        >
          <KeyIcon className={cn("h-4 w-4", hasApiKey && "text-green-500")} />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[280px] rounded-3xl pl-4">
        <DialogHeader className="border-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="api-key" className="mb-2">
              App key
            </Label>
            <div className="relative">
              <Input
                id="api-key"
                type={showKey ? "text" : "password"}
                placeholder={hasApiKey ? "********" : "Enter the App key"}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="rounded-full pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowKey(!showKey)}
                aria-label={showKey ? "Hide App key" : "Show App key"}
              >
                {showKey ? (
                  <EyeIcon className="h-4 w-4" />
                ) : (
                  <EyeOffIcon className="h-4 w-4" />
                )}
              </Button>
            </div>
            {hasApiKey && (
              <p className="text-muted-foreground text-xs">
                <CheckIcon className="mr-1 inline h-3 w-3 text-green-500" />
                App key is configured
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          {hasApiKey && (
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => {
                setApiKey(null);
                setInputValue("");
              }}
            >
              Clear
            </Button>
          )}
          <Button
            className="rounded-full"
            onClick={() => {
              if (inputValue.trim()) {
                setApiKey(inputValue.trim());
                setOpen(false);
                setInputValue("");
              }
            }}
            disabled={!inputValue.trim()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
