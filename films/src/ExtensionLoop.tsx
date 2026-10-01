import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Grade, clamp } from "./kit";

export const EXTENSION_SECONDS = 10;
const CLIP = "13522186";
/** Where the loop starts in the clip, and how long its tail dissolves into its head. */
const START = 2;
const BLEND = 1;

function Take({ from, fadeIn }: { from: number; fadeIn?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ opacity: fadeIn ? clamp(frame / fadeIn) : 1 }}>
      <OffthreadVideo
        src={staticFile(`footage/${CLIP}.mp4`)}
        trimBefore={Math.round(from * fps)}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "62% 50%", filter: "brightness(0.95) contrast(1.06) saturate(0.8)" }}
      />
    </AbsoluteFill>
  );
}

/**
 * The Secret Guard page's background: a developer's laptop at night, the left of the frame
 * dark for the title. Seamless: over the last second the clip dissolves into the second
 * that precedes its first frame, so the end lands exactly on the start.
 */
export function ExtensionLoop() {
  const { fps } = useVideoConfig();
  const tail = (EXTENSION_SECONDS - BLEND) * fps;
  return (
    <AbsoluteFill style={{ backgroundColor: "#050d1b" }}>
      <Take from={START} />
      <Sequence from={tail}>
        <Take from={START - BLEND} fadeIn={BLEND * fps} />
      </Sequence>
      <Grade grain={0.04} />
    </AbsoluteFill>
  );
}
