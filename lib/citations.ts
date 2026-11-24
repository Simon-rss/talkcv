import type { LocalizedText, PortfolioProfile } from "./schema";

type Citation = { kind: "project" | "exp"; id: string; title: LocalizedText };

export function parseCitations(text: string, profile: Pick<PortfolioProfile, "projects" | "experiences">): (string | Citation)[] {
  const parts: (string | Citation)[] = [];
  // Drop incomplete trailing markers while the answer is streaming.
  const markers = /\[\[cite:([^\]\n]*)\]\]|\[\[cite:[^\]\n]*\]?$/g;
  let end = 0;
  for (const match of text.matchAll(markers)) {
    if (match.index > end) parts.push(text.slice(end, match.index));
    const ref = /^(project|exp):([^:]+)$/.exec(match[1] ?? "");
    if (ref?.[1] === "project") {
      const project = profile.projects.find((item) => item.slug === ref[2]);
      if (project) parts.push({ kind: "project", id: project.slug, title: project.title });
    } else if (ref?.[1] === "exp" && /^(0|[1-9]\d*)$/.test(ref[2])) {
      const experience = profile.experiences[Number(ref[2])];
      if (experience) parts.push({ kind: "exp", id: ref[2], title: experience.company });
    }
    end = match.index + match[0].length;
  }
  if (end < text.length) parts.push(text.slice(end));
  return parts;
}
