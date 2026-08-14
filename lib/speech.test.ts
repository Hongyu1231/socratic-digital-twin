import { describe, expect, it } from "vitest";
import { selectPreferredEnglishVoice } from "@/lib/speech";

describe("selectPreferredEnglishVoice", () => {
  it("prefers a local Singapore English voice", () => {
    const voices = [
      { name: "US cloud", lang: "en-US", localService: false },
      { name: "Singapore local", lang: "en_SG", localService: true },
      { name: "British local", lang: "en-GB", localService: true },
    ];

    expect(selectPreferredEnglishVoice(voices)?.name).toBe("Singapore local");
  });

  it("keeps the preferred Singapore locale when only a remote voice exists", () => {
    const voices = [
      { name: "Singapore cloud", lang: "en-SG", localService: false },
      { name: "British local", lang: "en-GB", localService: true },
    ];

    expect(selectPreferredEnglishVoice(voices)?.name).toBe("Singapore cloud");
  });

  it("returns any English voice when preferred locales are unavailable", () => {
    const voices = [
      { name: "French", lang: "fr-FR", localService: true },
      { name: "Irish English", lang: "en-IE", localService: true },
    ];

    expect(selectPreferredEnglishVoice(voices)?.name).toBe("Irish English");
  });

  it("lets the browser use its default when no English voice exists", () => {
    expect(selectPreferredEnglishVoice([{ name: "French", lang: "fr-FR" }])).toBeUndefined();
  });
});
