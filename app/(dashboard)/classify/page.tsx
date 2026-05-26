import type { Metadata } from "next";
import { ClassifyClient } from "./client";

export const metadata: Metadata = { title: "Classify" };

export default function ClassifyPage() {
  return <ClassifyClient />;
}
