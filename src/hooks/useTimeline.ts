import { useState, useEffect, useCallback } from "react";

export interface TimelineControls {
  currentIndex: number;
  isPlaying: boolean;
  speed: number;
  totalFrames: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (index: number) => void;
  setSpeed: (speed: number) => void;
}

export function useTimeline(totalFrames: number): TimelineControls {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(3);

  useEffect(() => {
    if (!isPlaying || totalFrames === 0) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= totalFrames - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1000 / speed);
    return () => clearInterval(interval);
  }, [isPlaying, speed, totalFrames]);

  // Auto-advance to latest in live mode
  useEffect(() => {
    if (!isPlaying) {
      setCurrentIndex(Math.max(0, totalFrames - 1));
    }
  }, [totalFrames, isPlaying]);

  const seek = useCallback(
    (i: number) => setCurrentIndex(Math.max(0, Math.min(i, totalFrames - 1))),
    [totalFrames]
  );

  return {
    currentIndex,
    isPlaying,
    speed,
    totalFrames,
    play: () => setIsPlaying(true),
    pause: () => setIsPlaying(false),
    toggle: () => setIsPlaying((p) => !p),
    seek,
    setSpeed,
  };
}
