export type Orientation = "Landscape" | "Portrait" | "Square";

export interface VideoMeta {
  file: File;
  url: string;
  name: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  orientation: Orientation;
}

export interface Overlay {
  id: string;
  name: string;
  src: string; // object URL
  file: File;
  visible: boolean;
  // Position & size as ratios of the video (0..1)
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number; // degrees
  opacity: number; // 0..1
  z: number;
  naturalW: number;
  naturalH: number;
}

export interface ChunkResult {
  id: string;
  name: string;
  blob: Blob;
  url: string;
  size: number;
}