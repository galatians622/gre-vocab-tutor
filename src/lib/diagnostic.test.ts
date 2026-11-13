import { describe, expect, it } from "vitest";
import { summarize, type Outcome } from "./diagnostic";

const o = (level: number, correct: boolean, common = true): Outcome => ({ level, common, type: "recognition", correct, label: `w${level}` });

describe("placement test", () => {
  it("starts new words at the first level below 75%", () => {
    const r = summarize([o(1, true), o(1, true), o(1, true), o(1, true), o(2, true), o(2, false), o(2, false), o(2, true), o(3, false)]);
    expect(r.startLevel).toBe(2);
  });
  it("75% exactly counts as known", () => {
    const r = summarize([o(1, true), o(1, true), o(1, true), o(1, false), o(2, false), o(3, false)]);
    expect(r.startLevel).toBe(2);
  });
  it("starts at advanced when every level is strong", () => {
    expect(summarize([o(1, true), o(2, true), o(3, true)]).startLevel).toBe(3);
  });
  it("reports common-word familiarity separately", () => {
    const r = summarize([o(1, true, true), o(1, false, true), o(3, false, false)]);
    expect(r.commonAccuracy).toBe(0.5);
  });
});
