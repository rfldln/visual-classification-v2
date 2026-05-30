import { GenerateClient } from "./client";

// Image generation (T2I/I2I) runs as Server Actions invoked from this page; they inherit
// this maxDuration. Video generation uses a submit + client-poll flow, so it is not bound
// by this limit. Requires Fluid Compute enabled for values above the default tier cap.
export const runtime = "nodejs";
export const maxDuration = 300;

export default function GeneratePage() {
  return <GenerateClient />;
}
