// Scenario-based manual test harness for PptxController against real
// PowerPoint COM automation. Not a unit test suite -- there's no feasible way
// to mock real COM calls, so this drives the actual module against a small
// matrix of generated sample decks (see make-test-deck.ps1) plus dedicated
// error-path and crash-recovery scenarios, and reports pass/fail per
// scenario. Run: node run-tests.mjs
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PptxController, PodiumCommandError } from "../pptxController.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const deck = (name) => path.join(__dirname, name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passCount = 0;
let failCount = 0;
const failures = [];

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`expected ${label} === ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertThrowsCode(fn, expectedCode, label) {
  return fn().then(
    () => {
      throw new Error(`expected ${label} to throw with code ${expectedCode}, but it resolved`);
    },
    (err) => {
      if (!(err instanceof PodiumCommandError)) {
        throw new Error(`expected ${label} to throw PodiumCommandError, got ${err}`);
      }
      if (err.podiumError.code !== expectedCode) {
        throw new Error(`expected ${label} error code ${expectedCode}, got ${err.podiumError.code}`);
      }
    },
  );
}

async function killPowerPoint() {
  await new Promise((resolve) => {
    const p = spawn("taskkill", ["/IM", "POWERPNT.EXE", "/F"], { stdio: "ignore" });
    p.on("exit", () => resolve(undefined));
    p.on("error", () => resolve(undefined));
  });
}

/** @param {string} name @param {() => Promise<void>} fn */
async function scenario(name, fn) {
  process.stdout.write(`\n== ${name} ==\n`);
  await killPowerPoint();
  await sleep(300);
  const podium = new PptxController();
  podium.on("error", (e) => process.stdout.write(`  [error event] ${e.code}: ${e.message}\n`));
  try {
    await fn(podium);
    console.log(`PASS: ${name}`);
    passCount++;
  } catch (err) {
    console.log(`FAIL: ${name} -- ${err instanceof Error ? err.message : err}`);
    failCount++;
    failures.push(name);
  } finally {
    await podium.shutdown().catch(() => {});
  }
}

async function main() {
  await scenario("single-video deck: full lifecycle", async (podium) => {
    await podium.executeCommand({
      type: "load_presentation",
      sessionId: "s1",
      fileUrl: deck("deck-single-video.pptx"),
      presentationId: "p1",
      videoTrims: [{ slideNumber: 2, mediaId: "m1", startSeconds: 5, endSeconds: 15 }],
    });
    assertEqual(podium.getStatus().totalSlides, 3, "totalSlides");
    await podium.executeCommand({ type: "play", sessionId: "s1" });
    assertEqual(podium.getStatus().currentSlide, 1, "currentSlide after play");
    await podium.executeCommand({ type: "goto_slide", sessionId: "s1", slideNumber: 2 });
    assertEqual(podium.getStatus().currentSlide, 2, "currentSlide after goto_slide(2)");
    await podium.executeCommand({ type: "next_slide", sessionId: "s1" });
    assertEqual(podium.getStatus().currentSlide, 3, "currentSlide after next_slide");
    await podium.executeCommand({ type: "prev_slide", sessionId: "s1" });
    await podium.executeCommand({ type: "prev_slide", sessionId: "s1" });
    assertEqual(podium.getStatus().currentSlide, 1, "currentSlide after prev_slide x2");
    await podium.executeCommand({ type: "exit_slideshow", sessionId: "s1" });
    assertEqual(podium.getStatus().state, "ready", "state after exit_slideshow");
  });

  await scenario("multi-video deck: independent video slides", async (podium) => {
    await podium.executeCommand({
      type: "load_presentation",
      sessionId: "s2",
      fileUrl: deck("deck-multi-video.pptx"),
      presentationId: "p2",
      videoTrims: [
        { slideNumber: 2, mediaId: "m1", startSeconds: 5, endSeconds: 15 },
        { slideNumber: 4, mediaId: "m2", startSeconds: 5, endSeconds: 15 },
      ],
    });
    assertEqual(podium.getStatus().totalSlides, 5, "totalSlides");
    await podium.executeCommand({ type: "play", sessionId: "s2" });
    await podium.executeCommand({ type: "goto_slide", sessionId: "s2", slideNumber: 2 });
    assertEqual(podium.getStatus().currentSlide, 2, "currentSlide after goto_slide(2)");
    await podium.executeCommand({ type: "goto_slide", sessionId: "s2", slideNumber: 4 });
    assertEqual(podium.getStatus().currentSlide, 4, "currentSlide after goto_slide(4), second video slide");
    await podium.executeCommand({ type: "goto_slide", sessionId: "s2", slideNumber: 3 });
    assertEqual(podium.getStatus().currentSlide, 3, "currentSlide after goto_slide(3), plain slide between two videos");
  });

  await scenario("video-on-first-slide deck: play() itself must trigger the click", async (podium) => {
    await podium.executeCommand({
      type: "load_presentation",
      sessionId: "s3",
      fileUrl: deck("deck-video-first.pptx"),
      presentationId: "p3",
      videoTrims: [{ slideNumber: 1, mediaId: "m1", startSeconds: 5, endSeconds: 15 }],
    });
    await podium.executeCommand({ type: "play", sessionId: "s3" });
    assertEqual(podium.getStatus().currentSlide, 1, "currentSlide after play lands on the video slide");
    await podium.executeCommand({ type: "next_slide", sessionId: "s3" });
    assertEqual(podium.getStatus().currentSlide, 2, "currentSlide after next_slide off the video-first slide");
  });

  await scenario("no-video deck: nav is unaffected by click logic", async (podium) => {
    await podium.executeCommand({
      type: "load_presentation",
      sessionId: "s4",
      fileUrl: deck("deck-no-video.pptx"),
      presentationId: "p4",
      videoTrims: [],
    });
    await podium.executeCommand({ type: "play", sessionId: "s4" });
    await podium.executeCommand({ type: "next_slide", sessionId: "s4" });
    assertEqual(podium.getStatus().currentSlide, 2, "currentSlide after next_slide, no video anywhere");
    await podium.executeCommand({ type: "next_slide", sessionId: "s4" });
    assertEqual(podium.getStatus().currentSlide, 3, "currentSlide after 2nd next_slide");
  });

  await scenario("error path: file_not_found", async (podium) => {
    await assertThrowsCode(
      () =>
        podium.executeCommand({
          type: "load_presentation",
          sessionId: "s5",
          fileUrl: deck("this-file-does-not-exist.pptx"),
          presentationId: "p5",
          videoTrims: [],
        }),
      "file_not_found",
      "load_presentation with a missing file",
    );
  });

  await scenario("error path: nav before play", async (podium) => {
    await podium.executeCommand({
      type: "load_presentation",
      sessionId: "s6",
      fileUrl: deck("deck-no-video.pptx"),
      presentationId: "p6",
      videoTrims: [],
    });
    await assertThrowsCode(
      () => podium.executeCommand({ type: "next_slide", sessionId: "s6" }),
      "com_call_failed",
      "next_slide before play",
    );
  });

  await scenario("reload: loading a second session tears down the first cleanly", async (podium) => {
    await podium.executeCommand({
      type: "load_presentation",
      sessionId: "s7a",
      fileUrl: deck("deck-single-video.pptx"),
      presentationId: "p7a",
      videoTrims: [],
    });
    await podium.executeCommand({ type: "play", sessionId: "s7a" });
    await podium.executeCommand({ type: "goto_slide", sessionId: "s7a", slideNumber: 2 });
    // A new load_presentation arrives mid-slideshow -- must not error, must
    // fully replace the old session.
    await podium.executeCommand({
      type: "load_presentation",
      sessionId: "s7b",
      fileUrl: deck("deck-no-video.pptx"),
      presentationId: "p7b",
      videoTrims: [],
    });
    assertEqual(podium.getStatus().sessionId, "s7b", "sessionId after reload");
    assertEqual(podium.getStatus().state, "ready", "state after reload");
    assertEqual(podium.getStatus().totalSlides, 3, "totalSlides reflects the NEW deck, not the old one");
  });

  await scenario("crash recovery: PowerPoint killed mid-session, then recovers on next load", async (podium) => {
    await podium.executeCommand({
      type: "load_presentation",
      sessionId: "s8",
      fileUrl: deck("deck-single-video.pptx"),
      presentationId: "p8",
      videoTrims: [],
    });
    await podium.executeCommand({ type: "play", sessionId: "s8" });

    let sawCrashError = false;
    podium.once("error", (e) => {
      if (e.code === "powerpoint_crashed") sawCrashError = true;
    });

    // Killing POWERPNT.EXE does NOT kill the PowerShell worker process --
    // they're separate processes, COM automation doesn't parent/child them.
    // Detection has to come from the background status poll noticing
    // powerpointAlive: false (Get-Process-based, not a COM call), since nav
    // commands aren't being sent right now for a COM call to fail on.
    await killPowerPoint();
    await sleep(1500); // let a poll tick (every 500ms while "playing") catch it

    assertEqual(podium.getStatus().state, "error", "state after PowerPoint is killed externally");
    if (!sawCrashError) {
      throw new Error("expected a powerpoint_crashed error event after killing PowerPoint externally");
    }

    // The controller must be able to recover on the very next command.
    await podium.executeCommand({
      type: "load_presentation",
      sessionId: "s8b",
      fileUrl: deck("deck-single-video.pptx"),
      presentationId: "p8b",
      videoTrims: [],
    });
    assertEqual(podium.getStatus().state, "ready", "state after recovering with a fresh load_presentation");
  });

  console.log(`\n${"=".repeat(50)}`);
  console.log(`${passCount} passed, ${failCount} failed`);
  if (failures.length > 0) {
    console.log("Failed scenarios:", failures.join(", "));
  }
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("HARNESS CRASHED:", err);
  process.exit(1);
});
