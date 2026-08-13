import type { Metadata } from "next";
import { ExposureApp } from "./_components/exposure-app";

export const metadata: Metadata = {
  title: "Exposure",
  description:
    "What you actually own, how you ended up owning it, and what else moves with it — every route quantified.",
};

export default function ExposurePage() {
  return <ExposureApp />;
}
