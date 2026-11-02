/** Pure helpers for the Agency Agents library (MIT, github.com/msitarzewski/agency-agents). No I/O: unit-tested. */

export interface AgentTemplate {
  slug: string;
  division: string;
  name: string;
  emoji: string;
  description: string;
  vibe: string;
  instructions: string;
}

/** Roles an agency selling websites, HR services and outreach gets value from first. */
export const RECOMMENDED_SLUGS = [
  "sales/sales-outbound-strategist",
  "sales/sales-offer-lead-gen-strategist",
  "sales/sales-proposal-strategist",
  "marketing/marketing-linkedin-content-creator",
  "marketing/marketing-seo-specialist",
  "marketing/marketing-instagram-curator",
  "marketing/marketing-social-media-strategist",
  "engineering/engineering-frontend-developer",
  "design/design-ui-designer",
  "support/support-support-responder",
] as const;

/** Which of our departments a library division belongs to (by department name; null = none). */
export function departmentFor(division: string): "Growth" | "Finance" | "Operations" | null {
  if (["sales", "marketing", "paid-media"].includes(division)) return "Growth";
  if (division === "finance") return "Finance";
  if (["engineering", "design", "testing", "product", "project-management", "support", "security"].includes(division)) return "Operations";
  return null;
}

/** Case-insensitive search over name, description and vibe; every word must match. Optional division filter. */
export function searchTemplates(all: readonly AgentTemplate[], query = "", division = "", limit = 60): AgentTemplate[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  return all
    .filter((t) => !division || t.division === division)
    .filter((t) => {
      if (!words.length) return true;
      const hay = `${t.name} ${t.description} ${t.vibe} ${t.division}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .slice(0, Math.max(1, Math.min(limit, 300)));
}

const MAX_INSTRUCTIONS = 8000;

/** Builds the agent row for a hired template; fits the agents table limits (name 80, designation 120, instructions 8000). */
export function agentFromTemplate(t: AgentTemplate, divisionLabel: string) {
  const footer = `\n\n---\nRole template: ${t.name} (${divisionLabel}) from Agency Agents, MIT licence. Adapt advice to our company, budget and rules above.`;
  return {
    name: t.name.slice(0, 80),
    designation: `${t.name} · ${divisionLabel}`.slice(0, 120),
    instructions: t.instructions.slice(0, MAX_INSTRUCTIONS - footer.length) + footer,
    template_slug: t.slug,
  };
}
