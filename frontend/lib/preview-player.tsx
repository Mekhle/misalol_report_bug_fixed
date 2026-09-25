"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

interface PreviewPlayerValue {
  requestedId: string | null;
  requestNonce: number;
  pauseNonce: number;
  activeId: string | null;
  playing: boolean;
  requestPlay: (id: string) => void;
  requestPause: () => void;
  notify: (id: string | null, playing: boolean) => void;
}

const PreviewPlayerContext = createContext<PreviewPlayerValue>({
  requestedId: null,
  requestNonce: 0,
  pauseNonce: 0,
  activeId: null,
  playing: false,
  requestPlay: () => undefined,
  requestPause: () => undefined,
  notify: () => undefined,
});

export function PreviewPlayerProvider({ children }: { children: React.ReactNode }) {
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const [requestNonce, setRequestNonce] = useState(0);
  const [pauseNonce, setPauseNonce] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const requestPlay = useCallback((id: string) => {
    setRequestedId(id);
    setRequestNonce((value) => value + 1);
  }, []);
  const requestPause = useCallback(() => {
    setPauseNonce((value) => value + 1);
  }, []);

  const notify = useCallback((id: string | null, nextPlaying: boolean) => {
    setActiveId(id);
    setPlaying(nextPlaying);
  }, []);

  const value = useMemo(
    () => ({ requestedId, requestNonce, pauseNonce, activeId, playing, requestPlay, requestPause, notify }),
    [requestedId, requestNonce, pauseNonce, activeId, playing, requestPlay, requestPause, notify],
  );

  return <PreviewPlayerContext.Provider value={value}>{children}</PreviewPlayerContext.Provider>;
}

export function usePreviewPlayer() {
  return useContext(PreviewPlayerContext);
}
