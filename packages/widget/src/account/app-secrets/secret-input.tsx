"use client";

import { useState, type FC } from "react";
import {
  ShieldIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { useControl, cn } from "@aomi-labs/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";

export type SecretInputProps = {
  className?: string;
  title?: string;
  description?: string;
};

type SecretEntry = { name: string; value: string };

export const SecretInput: FC<SecretInputProps> = ({
  className,
  title = "Secrets",
  description = "Add API keys for third-party services. Secrets are stored in memory only and never saved to disk.",
}) => {
  const { ingestSecrets, clearSecrets } = useControl();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<SecretEntry[]>([
    { name: "", value: "" },
  ]);
  const [savedNames, setSavedNames] = useState<string[]>([]);
  const [showValues, setShowValues] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasSecrets = savedNames.length > 0;

  const updateEntry = (
    index: number,
    field: "name" | "value",
    val: string,
  ) => {
    setEntries((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  };

  const addEntry = () => {
    setEntries((prev) => [...prev, { name: "", value: "" }]);
  };

  const removeEntry = (index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const validEntries = entries.filter(
    (e) => e.name.trim() && e.value.trim(),
  );

  const handleSave = async () => {
    if (validEntries.length === 0) return;
    setSaving(true);
    try {
      const secrets: Record<string, string> = {};
      for (const entry of validEntries) {
        secrets[entry.name.trim()] = entry.value.trim();
      }
      await ingestSecrets(secrets);
      setSavedNames((prev) => [
        ...new Set([...prev, ...Object.keys(secrets)]),
      ]);
      setEntries([{ name: "", value: "" }]);
      setOpen(false);
    } catch (error) {
      console.error("[SecretInput] Failed to ingest secrets:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await clearSecrets();
      setSavedNames([]);
      setEntries([{ name: "", value: "" }]);
    } catch (error) {
      console.error("[SecretInput] Failed to clear secrets:", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative rounded-full", className)}
          aria-label={hasSecrets ? "Secrets configured" : "Add secrets"}
        >
          <ShieldIcon
            className={cn("h-4 w-4", hasSecrets && "text-green-500")}
          />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[340px] rounded-3xl pl-4">
        <DialogHeader className="border-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-4">
          {hasSecrets && (
            <div className="text-muted-foreground text-xs">
              <CheckIcon className="mr-1 inline h-3 w-3 text-green-500" />
              {savedNames.length} secret{savedNames.length > 1 ? "s" : ""}{" "}
              configured: {savedNames.join(", ")}
            </div>
          )}

          {entries.map((entry, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="grid flex-1 gap-1">
                {index === 0 && (
                  <Label className="text-xs">Name</Label>
                )}
                <Input
                  type="text"
                  placeholder="MY_API_KEY"
                  value={entry.name}
                  onChange={(e) => updateEntry(index, "name", e.target.value)}
                  className="h-8 rounded-full text-xs"
                />
              </div>
              <div className="grid flex-1 gap-1">
                {index === 0 && (
                  <Label className="flex items-center gap-1 text-xs">
                    Value
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4 p-0 hover:bg-transparent"
                      onClick={() => setShowValues(!showValues)}
                      aria-label={showValues ? "Hide values" : "Show values"}
                    >
                      {showValues ? (
                        <EyeIcon className="h-3 w-3" />
                      ) : (
                        <EyeOffIcon className="h-3 w-3" />
                      )}
                    </Button>
                  </Label>
                )}
                <Input
                  type={showValues ? "text" : "password"}
                  placeholder="sk-..."
                  value={entry.value}
                  onChange={(e) => updateEntry(index, "value", e.target.value)}
                  className="h-8 rounded-full text-xs"
                />
              </div>
              {entries.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-full"
                  onClick={() => removeEntry(index)}
                  aria-label="Remove entry"
                >
                  <XIcon className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit rounded-full text-xs"
            onClick={addEntry}
          >
            <PlusIcon className="mr-1 h-3 w-3" />
            Add another
          </Button>
        </div>
        <DialogFooter>
          {hasSecrets && (
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => void handleClear()}
              disabled={saving}
            >
              Clear all
            </Button>
          )}
          <Button
            className="rounded-full"
            onClick={() => void handleSave()}
            disabled={validEntries.length === 0 || saving}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
