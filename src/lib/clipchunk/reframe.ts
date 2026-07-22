import type { ReframeMode } from "./types";

const SHORT_FORM_WIDTH = 720;
const SHORT_FORM_HEIGHT = 1280;
const SHORT_FORM_ASPECT = SHORT_FORM_WIDTH / SHORT_FORM_HEIGHT;

interface ReframeGeometry {
  outputWidth: number;
  outputHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

function toEven(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

export function getReframeGeometry(sourceWidth: number, sourceHeight: number, mode: ReframeMode): ReframeGeometry {
  if (mode !== "short") {
    return {
      outputWidth: toEven(sourceWidth),
      outputHeight: toEven(sourceHeight),
      cropX: 0,
      cropY: 0,
      cropWidth: toEven(sourceWidth),
      cropHeight: toEven(sourceHeight),
    };
  }

  const sourceAspect = sourceWidth / sourceHeight;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  let cropX = 0;
  let cropY = 0;

  if (sourceAspect > SHORT_FORM_ASPECT) {
    cropWidth = sourceHeight * SHORT_FORM_ASPECT;
    cropX = (sourceWidth - cropWidth) / 2;
  } else if (sourceAspect < SHORT_FORM_ASPECT) {
    cropHeight = sourceWidth / SHORT_FORM_ASPECT;
    cropY = (sourceHeight - cropHeight) / 2;
  }

  return {
    outputWidth: SHORT_FORM_WIDTH,
    outputHeight: SHORT_FORM_HEIGHT,
    cropX: toEven(cropX),
    cropY: toEven(cropY),
    cropWidth: toEven(cropWidth),
    cropHeight: toEven(cropHeight),
  };
}
