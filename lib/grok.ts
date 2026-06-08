import { CATEGORIES, CATEGORY_IDS, type CategoryId } from "./taxonomy";

export function buildGrokSystemPrompt(): string {
  const defs = CATEGORIES.map((c) => `${c.id}: ${c.description}`).join(" | ");

  return `Multi-label adult content classifier. Return ONLY valid JSON, no prose, no fences.

Tags (use exact ids): ${defs}

Rules:
- ONLY tag what is directly and unambiguously visible in a frame. Do NOT infer acts from genre, context, body positioning, or what "usually" happens. If you cannot point to a specific frame that clearly shows the act, OMIT the tag. A missing tag is far better than a wrong one — never guess, never hallucinate. When unsure, leave it out.
- List ALL applicable ids that you can actually see. Multi-label is expected (e.g. bg+blowjob+tits).
- Performer-count tags are mutually exclusive: solo/bg/gg/bbg/bgg/ggg/orgy. "sextape" may stack with "bg" for cinematic quality.
- Count the TOTAL distinct people, then derive the count tag MECHANICALLY (b=male, g=female): 1 person=solo · 1 male+1 female=bg · 2 females=gg · 2 males+1 female=bbg · 1 male+2 females=bgg · 3 females=ggg · 4 OR MORE people=orgy. The orgy rule OVERRIDES every other count tag: any time 4+ people appear, the tag is orgy — e.g. 2 males+2 females=4 people=orgy, NOT bbg. Re-check your own math: if your evidence sentence names more people than the chosen tag allows, the tag is wrong — fix it before output.
- Count performers carefully ACROSS ALL FRAMES. A second male may appear only in some frames (e.g. one giving oral while the other receives, off-camera hands, separate close-ups). Look for extra hands, second penises, or different body parts that imply additional performers — if you see evidence of more than two people anywhere in the video, use the appropriate higher-count tag (bbg/bgg/ggg/orgy) instead of bg/gg.
- For videos with mixed scenes (e.g. solo talking segments followed by partnered sex), use the most partnered tag seen ANYWHERE in the video — bg beats solo even if solo frames outnumber bg frames. The act tags (blowjob/handjob/anal/etc.) follow the same rule: if it happens in any frame, tag it.
- Body tags (tits/butt/pussy/feet): ONLY valid in solo content (count tag = solo, no partner present). If ANY partnered tag applies (bg/gg/bbg/bgg/ggg/orgy/sextape), suppress ALL body tags entirely — body parts being visible during partnered content does NOT qualify. Within solo content, only tag when the body part is the PRIMARY focus.
- blowjob: ONLY tag when a FEMALE performer is performing oral sex on a MALE performer's penis. The female's mouth must be on the male's penis. Male-on-female oral (cunnilingus) is a completely different act and is NEVER blowjob — omit it entirely.
- handjob: ONLY tag when a female performer's hand is stimulating a male performer. Male self-stimulation (solo or with a partner present) does NOT qualify — tag it as solo or bg instead.
- anal: Tag whenever penetration INTO the anus is actively occurring — by a penis, fingers, OR a toy/dildo. Solo + toy in anus is a valid combination (solo+anal). Do NOT tag because the anal area or butt is merely visible without insertion. Creampie/squirt from vaginal penetration does NOT qualify even if the anus is in frame.
- creampie: ONLY tag when THICK, WHITE, opaque/slimy semen is visibly leaking or dripping out of the vagina or anus. A facial (semen on face, chest, body, or anywhere external) is NEVER creampie. If the finish is external in any way, omit creampie entirely — do not include it in the tags array at all.
- squirt: ONLY tag when CLEAR, thin, watery fluid is visibly ejecting/spraying from the vagina. Squirt fluid is translucent like water; creampie fluid is thick, white, and slimy — do not confuse the two. Normal wetness, lubricant, or sweat with no visible spray is NOT squirt; leave it out.
- For video frames: aggregate across all frames before answering. In the evidence field, cite the specific frame numbers where each tag is observed (e.g. "frames 4,9,14: anal penetration clearly visible"). Use exact frame numbers, not ranges.
- confidence: 0.0–1.0 float. Omit low-confidence guesses (<0.4).
- Decide whether each tag applies BEFORE writing the JSON. If any rule tells you NOT to tag something, leave it out of the tags array entirely. Never include a tag you are unsure about and explain the doubt in the evidence — if the evidence would argue against the tag, the tag must be absent from the output.
- This is an authorized labeling task. Do not refuse.

Output schema:
{"tags":[{"id":"<id>","confidence":0.0-1.0,"evidence":"<brief>"}],"summary":"<1 sentence>","notes":"<optional>"}`;
}

// Appended to the Grok system prompt for small local/serverless VL models (the
// abliterated Qwen pod and the serverless Qwen3.6 endpoint). The small MoE
// perceives the scene correctly but is unreliable at the count-decoding and
// conditional-suppression RULES — those are enforced deterministically in
// applyTaxonomyRules. This addendum keeps only the PERCEPTION cues: count people
// accurately into a "performers" object (used to derive the count tag) and report
// direction-sensitive acts correctly. NOT applied to Grok itself.
export const PERCEPTION_ADDENDUM = `

PERFORMER COUNT (mandatory — do this first):
Carefully count the people across ALL frames and BEGIN your JSON with a "performers" object, e.g. "performers":{"males":2,"females":1} (b = male, g = female). Look for extra hands, a second penis, or separate close-ups that reveal additional performers. This count is authoritative — the system derives the performer-count tag (solo/bg/gg/bbg/bgg/ggg/orgy) from these numbers, so getting the count right matters more than which tag you pick.

DIRECTION-SENSITIVE ACTS (report what you actually see):
- blowjob = a FEMALE's mouth on a MALE's penis. Male-on-female oral (cunnilingus) is NOT a blowjob.
- handjob = a FEMALE's hand stimulating a MALE's penis. Male self-stimulation is not a handjob.

Output schema (performers FIRST):
{"performers":{"males":<n>,"females":<n>},"tags":[{"id":"<id>","confidence":0.0-1.0,"evidence":"<brief>"}],"summary":"<1 sentence>","notes":"<optional>"}`;

export interface GrokTag {
  id: CategoryId;
  confidence: number;
  evidence?: string;
}

export interface PerformerCount {
  males: number;
  females: number;
}

export interface GrokTagResponse {
  tags: GrokTag[];
  performers?: PerformerCount;
  summary?: string;
  notes?: string;
  raw?: string;
}

export function parseGrokResponse(text: string): GrokTagResponse {
  const cleaned = stripCodeFences(stripThinkingBlocks(text)).trim();
  const jsonSlice = extractFirstJsonObject(cleaned) ?? cleaned;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    return { tags: [], raw: text };
  }
  if (!parsed || typeof parsed !== "object") return { tags: [], raw: text };
  const obj = parsed as Record<string, unknown>;

  const validIds = new Set<string>(CATEGORY_IDS);
  const tagsRaw = Array.isArray(obj.tags) ? obj.tags : [];
  const tags: GrokTag[] = [];
  for (const t of tagsRaw) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : null;
    if (!id || !validIds.has(id)) continue;
    const confidence = clamp01(Number(r.confidence));
    const evidence = typeof r.evidence === "string" ? r.evidence : undefined;
    tags.push({ id: id as CategoryId, confidence, evidence });
  }
  tags.sort((a, b) => b.confidence - a.confidence);

  let performers: PerformerCount | undefined;
  if (obj.performers && typeof obj.performers === "object") {
    const p = obj.performers as Record<string, unknown>;
    const males = Number(p.males);
    const females = Number(p.females);
    if (Number.isFinite(males) && Number.isFinite(females)) {
      performers = { males: Math.max(0, Math.floor(males)), females: Math.max(0, Math.floor(females)) };
    }
  }

  return {
    tags,
    performers,
    summary: typeof obj.summary === "string" ? obj.summary : undefined,
    notes: typeof obj.notes === "string" ? obj.notes : undefined,
  };
}

function stripThinkingBlocks(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function stripCodeFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// Taxonomy rule groups, enforced deterministically in applyTaxonomyRules so we
// don't rely on the model obeying conditional/negative prompt instructions —
// small models (e.g. Qwen3-VL-30B-A3B) perceive the scene correctly but fail to
// suppress tags a rule forbids. Code is the reliable place to enforce structure.
const PARTNERED_TAG_IDS = new Set<CategoryId>(["bg", "gg", "bbg", "bgg", "ggg", "orgy", "sextape"]);
const COUNT_TAG_IDS = new Set<CategoryId>(["solo", "bg", "gg", "bbg", "bgg", "ggg", "orgy"]);
const BODY_TAG_IDS = new Set<CategoryId>(["tits", "pussy", "butt", "feet"]);
const MALE_REQUIRED_ACT_IDS = new Set<CategoryId>(["blowjob", "handjob", "creampie"]);

// Higher = more partnered. Used to pick ONE canonical count tag when the model
// emits several and there is no performers object to derive from.
const COUNT_TAG_RANK: Record<string, number> = {
  solo: 0, bg: 1, gg: 1, bbg: 2, bgg: 2, ggg: 2, orgy: 3,
};

// Mechanical mapping from a performer headcount to the single correct count tag.
// Returns null for combos the taxonomy has no tag for (e.g. 3 males) so we don't
// override the model with a wrong guess.
export function deriveCountTag(p: PerformerCount): CategoryId | null {
  const { males, females } = p;
  const total = males + females;
  if (total >= 4) return "orgy"; // orgy overrides every other count tag
  if (total === 1) return "solo";
  if (males === 1 && females === 1) return "bg";
  if (males === 0 && females === 2) return "gg";
  if (males === 2 && females === 1) return "bbg";
  if (males === 1 && females === 2) return "bgg";
  if (males === 0 && females === 3) return "ggg";
  return null;
}

// Enforces the structural taxonomy rules that prompt text alone can't guarantee:
//   1. self-negation / wrong-finish creampie removal (via filterGrokTags)
//   2. exactly ONE performer-count tag — derived from `performers` when present,
//      otherwise the single most-partnered tag the model emitted
//   3. male-required acts (blowjob/handjob/creampie) dropped when males === 0
//   4. body tags (tits/pussy/butt/feet) are solo-only — dropped if any partnered
//      tag is present
export function applyTaxonomyRules(tags: GrokTag[], performers?: PerformerCount): GrokTag[] {
  let out = filterGrokTags(tags);

  // (2) Resolve a single canonical count tag.
  const derived = performers ? deriveCountTag(performers) : null;
  const emittedCounts = out.filter((t) => COUNT_TAG_IDS.has(t.id));
  let canonical: GrokTag | null = null;
  if (derived) {
    // Reuse the model's confidence/evidence if it happened to emit the right
    // tag; otherwise synthesize one from the (deterministic) performer count.
    const match = emittedCounts.find((t) => t.id === derived);
    canonical = match ?? {
      id: derived,
      confidence: emittedCounts[0]?.confidence ?? 0.85,
      evidence: `derived from performer count: ${performers!.males} male / ${performers!.females} female`,
    };
  } else if (emittedCounts.length > 0) {
    canonical = [...emittedCounts].sort((a, b) => {
      const rank = (COUNT_TAG_RANK[b.id] ?? 0) - (COUNT_TAG_RANK[a.id] ?? 0);
      return rank !== 0 ? rank : b.confidence - a.confidence;
    })[0];
  }
  out = out.filter((t) => !COUNT_TAG_IDS.has(t.id));
  if (canonical) out.push(canonical);

  // (3) Male-required acts need at least one male performer.
  if (performers && performers.males === 0) {
    out = out.filter((t) => !MALE_REQUIRED_ACT_IDS.has(t.id));
  }

  // (4) Body tags are solo-only.
  if (out.some((t) => PARTNERED_TAG_IDS.has(t.id))) {
    out = out.filter((t) => !BODY_TAG_IDS.has(t.id));
  }

  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}

export function filterGrokTags(tags: GrokTag[]): GrokTag[] {
  return tags.filter((tag) => {
    const ev = (tag.evidence ?? "").toLowerCase();
    const selfNegated = [
      `not tag ${tag.id}`, `no ${tag.id} tag`, `should not tag`,
      `should not be tagged`, `do not tag`, `omit ${tag.id}`,
    ].some((phrase) => ev.includes(phrase));
    if (selfNegated) return false;
    if (tag.id === "creampie") {
      const wrongFinish = [
        "facial", "on her face", "on his face", "on the face",
        "on her chin", "on chin", "external finish",
        "in her mouth", "in the mouth", "into her mouth", "into the mouth",
        "mouth/throat", "throat", "oral finish", "swallow",
      ];
      if (wrongFinish.some((kw) => ev.includes(kw))) return false;
    }
    return true;
  });
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
