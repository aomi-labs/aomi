"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type FC,
  type ReactNode,
} from "react";

/** Phones get the activity bottom sheet; wider viewports keep the rail. */
export const PHONE_QUERY = "(max-width: 639px)";

const isPhone = () =>
  typeof window !== "undefined" &&
  Boolean(window.matchMedia?.(PHONE_QUERY).matches);

type ActivityPanelContextValue = {
  worthShowing: boolean;
  reviewing: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  setWorthShowing: (worthShowing: boolean, reviewing: boolean) => void;
};

const ActivityPanelContext = createContext<ActivityPanelContextValue>({
  worthShowing: false,
  reviewing: false,
  // Standalone ActivitySidebar renders stay visible; AomiFrame supplies the
  // managed provider whose compact state starts closed.
  open: true,
  setOpen: () => undefined,
  setWorthShowing: () => undefined,
});

export const ActivityPanelProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [open, setOpen] = useState(false);
  const [activityState, setActivityState] = useState({
    worthShowing: false,
    reviewing: false,
  });
  const worthShowingRef = useRef(false);
  const setWorthShowing = useCallback(
    (worthShowing: boolean, reviewing: boolean) => {
      const becameWorthShowing = worthShowing && !worthShowingRef.current;
      worthShowingRef.current = worthShowing;
      setActivityState((current) =>
        current.worthShowing === worthShowing && current.reviewing === reviewing
          ? current
          : { worthShowing, reviewing },
      );
      // Desktop opens the rail with the first activity. A phone waits for the
      // header button, or for a wallet request (see ActivitySidebar).
      if (becameWorthShowing && !isPhone()) setOpen(true);
      else if (!worthShowing) setOpen(false);
    },
    [],
  );
  const value = useMemo(
    () => ({ ...activityState, open, setOpen, setWorthShowing }),
    [activityState, open, setWorthShowing],
  );

  return (
    <ActivityPanelContext.Provider value={value}>
      {children}
    </ActivityPanelContext.Provider>
  );
};

export const useActivityPanel = (): ActivityPanelContextValue =>
  useContext(ActivityPanelContext);
