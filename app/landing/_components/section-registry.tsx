import type { ComponentType } from "react";
import type { LandingSection } from "../landing-config";
import { SectionPlaceholder } from "./section-placeholder";
import { Hero } from "./sections/hero";
import { Problem } from "./sections/problem";
import { Solution } from "./sections/solution";
import { Privacy } from "./sections/privacy";
import { Features } from "./sections/features";
import { Demo } from "./sections/demo";
import { Comparison } from "./sections/comparison";
import { Pricing } from "./sections/pricing";
import { Faq } from "./sections/faq";
import { FinalCta } from "./sections/final-cta";

/**
 * Maps a section id to its real component. This is the swap seam promised in
 * Milestone 1: each milestone implements one section and registers it here, and
 * page.tsx never changes. Any id without an entry falls back to the empty
 * placeholder, so the full IA always renders in order regardless of how many
 * sections are "done".
 */
export interface SectionProps {
  section: LandingSection;
  index: number;
}

const REGISTRY: Record<string, ComponentType<SectionProps>> = {
  hero: Hero,
  problem: Problem,
  solution: Solution,
  privacy: Privacy,
  features: Features,
  demo: Demo,
  comparison: Comparison,
  pricing: Pricing,
  faq: Faq,
  cta: FinalCta,
};

export function resolveSection(id: string): ComponentType<SectionProps> {
  return REGISTRY[id] ?? SectionPlaceholder;
}
