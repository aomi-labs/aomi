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
      if (becameWorthShowing) setOpen(true);
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
