// Manual smoke test for PptxController against the PoC's test_deck.pptx.
// Run: node smoke-test.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PptxController } from "./pptxController.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const deckPath = path.join(__dirname, "..", "..", "..", "com-poc", "test_deck.pptx");

const podium = new PptxController();
podium.on("status", (s) => console.log("[status]", JSON.stringify(s)));
podium.on("error", (e) => console.log("[error]", JSON.stringify(e)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`ASSERTION FAILED: ${label} -- expected ${expected}, got ${actual}`);
  }
  console.log(`  ok: ${label} === ${expected}`);
}

async function main() {
  console.log("== load_presentation ==");
  await podium.executeCommand({
    type: "load_presentation",
    sessionId: "smoke-1",
    fileUrl: deckPath,
    presentationId: "p1",
    videoTrims: [{ slideNumber: 2, mediaId: "m1", startSeconds: 5, endSeconds: 15 }],
  });
  assertEqual(podium.getStatus().state, "ready", "state after load");
  assertEqual(podium.getStatus().totalSlides, 3, "totalSlides after load");

  console.log("== play ==");
  await podium.executeCommand({ type: "play", sessionId: "smoke-1" });
  assertEqual(podium.getStatus().state, "playing", "state after play");
  assertEqual(podium.getStatus().currentSlide, 1, "currentSlide after play");
  await sleep(1500);

  console.log("== goto_slide(2) -- should click to trigger video ==");
  await podium.executeCommand({ type: "goto_slide", sessionId: "smoke-1", slideNumber: 2 });
  assertEqual(podium.getStatus().currentSlide, 2, "currentSlide after goto_slide(2), immediate read-back");
  await sleep(2000);

  console.log("== next_slide ==");
  await podium.executeCommand({ type: "next_slide", sessionId: "smoke-1" });
  assertEqual(podium.getStatus().currentSlide, 3, "currentSlide after next_slide, immediate read-back");

  console.log("== prev_slide x2 ==");
  await podium.executeCommand({ type: "prev_slide", sessionId: "smoke-1" });
  assertEqual(podium.getStatus().currentSlide, 2, "currentSlide after 1st prev_slide, immediate read-back");
  await podium.executeCommand({ type: "prev_slide", sessionId: "smoke-1" });
  assertEqual(podium.getStatus().currentSlide, 1, "currentSlide after 2nd prev_slide, immediate read-back");

  console.log("== exit_slideshow ==");
  await podium.executeCommand({ type: "exit_slideshow", sessionId: "smoke-1" });
  assertEqual(podium.getStatus().state, "ready", "state after exit_slideshow");
  assertEqual(podium.getStatus().currentSlide, null, "currentSlide after exit_slideshow");

  await podium.shutdown();
  console.log("ALL ASSERTIONS PASSED");
}

main().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  podium.shutdown().finally(() => process.exit(1));
});
