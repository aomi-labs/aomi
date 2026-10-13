import { useCallback, useEffect, useRef, useState } from "react";

export function useStreamingText(fullText: string, enabled: boolean) {
  const [displayed, setDisplayed] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const indexRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const start = (time: number) => {
      indexRef.current = 0;
      lastTimeRef.current = time;
      setDisplayed("");
      setIsStreaming(true);

      const stream = (t: number) => {
        if (indexRef.current >= fullText.length) {
          setIsStreaming(false);
          return;
        }

        if (t - lastTimeRef.current > 12) {
          const charsToAdd = Math.min(
            3,
            fullText.length - indexRef.current,
          );
          indexRef.current += charsToAdd;
          setDisplayed(fullText.slice(0, indexRef.current));
          lastTimeRef.current = t;
        }

        rafRef.current = requestAnimationFrame(stream);
      };

      rafRef.current = requestAnimationFrame(stream);
    };

    rafRef.current = requestAnimationFrame(start);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [fullText, enabled]);

  const skipToEnd = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    setDisplayed(fullText);
    setIsStreaming(false);
    indexRef.current = fullText.length;
  }, [fullText]);

  return { displayed, isStreaming, skipToEnd };
}
