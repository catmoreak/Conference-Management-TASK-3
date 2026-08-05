// @ts-check
/**
 * Node-side counterpart to worker.ps1. Owns the offline/online/loading/ready/
 * playing/error state machine (the worker only reports raw facts -- current
 * slide, total slides, alive/dead -- the same layering as server/'s
 * authorize.ts keeping policy out of the AuthzStore).
 *
 * Usage (from the WebSocket handler that owns parsing incoming messages):
 *
 *   import { PptxController, PodiumCommandError } from './pptx/pptxController.js';
 *   const podium = new PptxController();
 *   podium.on('status', (status) => ws.send(JSON.stringify(status)));
 *   podium.on('error', (error) => ws.send(JSON.stringify(error)));
 *   try {
 *     await podium.executeCommand(cmd);
 *   } catch (err) {
 *     // err instanceof PodiumCommandError -- err.podiumError is already sent
 *     // via the 'error' event above, so this catch is only needed if the
 *     // caller wants to react to the specific failed command.
 *   }
 *   const status = podium.getStatus(); // synchronous, last-known-good cache
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = path.join(__dirname, "worker.ps1");

const BOOT_TIMEOUT_MS = 15000;
const DEFAULT_TIMEOUT_MS = 8000;
const LOAD_TIMEOUT_MS = 20000;
const STATUS_TIMEOUT_MS = 3000;
const STATUS_POLL_INTERVAL_MS = 500;

const COMMAND_TIMEOUTS = {
  load_presentation: LOAD_TIMEOUT_MS,
  play: DEFAULT_TIMEOUT_MS,
  goto_slide: DEFAULT_TIMEOUT_MS,
  next_slide: DEFAULT_TIMEOUT_MS,
  prev_slide: DEFAULT_TIMEOUT_MS,
  exit_slideshow: DEFAULT_TIMEOUT_MS,
  get_status: STATUS_TIMEOUT_MS,
};

export class PodiumCommandError extends Error {
  /** @param {import('./types.js').PodiumError} podiumError */
  constructor(podiumError) {
    super(podiumError.message);
    this.name = "PodiumCommandError";
    /** @type {import('./types.js').PodiumError} */
    this.podiumError = podiumError;
  }
}

export class PptxController extends EventEmitter {
  constructor() {
    super();
    /** @type {import('node:child_process').ChildProcess | null} */
    this._worker = null;
    /** @type {import('node:readline').Interface | null} */
    this._rl = null;
    /** @type {Promise<void> | null} resolves once the worker has signaled ready */
    this._readyPromise = null;
    /** @type {Map<string, {resolve: (v: any) => void, reject: (e: any) => void, timer: NodeJS.Timeout}>} */
    this._pending = new Map();
    /** @type {import('./types.js').PodiumState} */
    this._state = "offline";
    this._sessionId = /** @type {string | null} */ (null);
    this._currentSlide = /** @type {number | null} */ (null);
    this._totalSlides = /** @type {number | null} */ (null);
    /** @type {NodeJS.Timeout | null} */
    this._pollTimer = null;
    // Set while intentionally tearing down the worker (restart/shutdown) so
    // the 'exit' handler doesn't misreport a deliberate kill as a crash.
    this._intentionalShutdown = false;
  }

  /** @returns {import('./types.js').PodiumStatus} */
  getStatus() {
    return {
      type: "status",
      sessionId: this._sessionId,
      state: this._state,
      currentSlide: this._currentSlide,
      totalSlides: this._totalSlides,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * @param {import('./types.js').PodiumCommand} cmd
   * @returns {Promise<void>}
   */
  async executeCommand(cmd) {
    try {
      // Only actually await when the worker isn't already up -- awaiting an
      // already-resolved promise still yields a scheduling tick, which is
      // exactly the gap the independent status-poll interval (see
      // _startPolling) can slip a get_status write through ahead of this
      // command's, reordering what the worker sees on its stdin even though
      // the worker itself processes strictly in arrival order. Confirmed via
      // the Node smoke test: a prev_slide called immediately after another
      // prev_slide intermittently landed on the wrong slide, and a poll
      // response for a slide index that shouldn't have been reachable yet
      // showed up interleaved between them.
      if (!this._worker || !this._readyPromise) {
        await this._ensureWorker();
      }

      switch (cmd.type) {
        case "load_presentation": {
          this._sessionId = cmd.sessionId;
          this._setState("loading");
          const result = await this._sendToWorker({
            command: "load_presentation",
            sessionId: cmd.sessionId,
            fileUrl: cmd.fileUrl,
            presentationId: cmd.presentationId,
            videoTrims: cmd.videoTrims,
          });
          this._currentSlide = null;
          this._totalSlides = result.totalSlides ?? null;
          this._setState("ready");
          return;
        }

        case "play": {
          const result = await this._sendToWorker({ command: "play" });
          this._currentSlide = result.currentSlide ?? null;
          this._totalSlides = result.totalSlides ?? null;
          this._setState("playing");
          this._startPolling();
          return;
        }

        case "goto_slide":
        case "next_slide":
        case "prev_slide": {
          const payload =
            cmd.type === "goto_slide"
              ? { command: cmd.type, slideNumber: cmd.slideNumber }
              : { command: cmd.type };
          const result = await this._sendToWorker(payload);
          this._currentSlide = result.currentSlide ?? null;
          this._totalSlides = result.totalSlides ?? null;
          this._setState("playing");
          return;
        }

        case "exit_slideshow": {
          const result = await this._sendToWorker({ command: "exit_slideshow" });
          this._stopPolling();
          this._currentSlide = result.currentSlide ?? null;
          this._totalSlides = result.totalSlides ?? null;
          this._setState("ready");
          return;
        }

        default: {
          const unknown = /** @type {any} */ (cmd);
          throw new PodiumCommandError(
            this._buildError("unknown", `Unknown command type: ${unknown && unknown.type}`),
          );
        }
      }
    } catch (err) {
      const podiumError =
        err instanceof PodiumCommandError
          ? err.podiumError
          : this._buildError("unknown", err instanceof Error ? err.message : String(err));
      this._setState("error");
      this.emit("error", podiumError);
      throw err instanceof PodiumCommandError ? err : new PodiumCommandError(podiumError);
    }
  }

  /** Stops polling and kills the worker. Call when the podium session is fully done. */
  async shutdown() {
    this._stopPolling();
    this._intentionalShutdown = true;
    if (this._worker) {
      try {
        this._worker.stdin?.end();
      } catch {}
      this._worker.kill();
    }
    this._worker = null;
    this._rl = null;
    this._readyPromise = null;
    this._setState("offline");
  }

  // ---- internals ----

  /** @param {import('./types.js').PodiumState} state */
  _setState(state) {
    if (this._state === state) return;
    this._state = state;
    this.emit("status", this.getStatus());
  }

  /**
   * @param {import('./types.js').PodiumErrorCode} code
   * @param {string} message
   * @returns {import('./types.js').PodiumError}
   */
  _buildError(code, message) {
    return {
      type: "error",
      sessionId: this._sessionId,
      code,
      message,
      timestamp: new Date().toISOString(),
    };
  }

  async _ensureWorker() {
    if (this._worker && this._readyPromise) {
      return this._readyPromise;
    }
    this._intentionalShutdown = false;
    // Kill any stray POWERPNT.EXE before spawning -- a prior worker that
    // timed out mid-COM-call may have left PowerPoint running stuck, and a
    // fresh worker attaching to that same hung instance would inherit the
    // hang instead of getting a clean process.
    await this._killStrayPowerPoint();

    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", WORKER_SCRIPT],
      { windowsHide: false, stdio: ["pipe", "pipe", "pipe"] },
    );
    this._worker = child;

    child.stderr?.on("data", (chunk) => {
      // Surfaced for debugging; not itself a failure signal (PowerShell
      // writes non-fatal warnings here too).
      console.error("[pptx worker stderr]", chunk.toString());
    });

    child.on("exit", (code, signal) => {
      this._worker = null;
      this._rl = null;
      this._readyPromise = null;
      this._stopPolling();
      const wasIntentional = this._intentionalShutdown;
      this._intentionalShutdown = false;
      this._rejectAllPending(
        this._buildError("powerpoint_crashed", `Worker process exited (code=${code}, signal=${signal})`),
      );
      if (!wasIntentional) {
        this._setState("error");
        this.emit("error", this._buildError("powerpoint_crashed", "PowerPoint worker exited unexpectedly"));
      }
    });

    const rl = createInterface({ input: child.stdout });
    this._rl = rl;

    this._readyPromise = new Promise((resolve, reject) => {
      const bootTimer = setTimeout(() => {
        reject(new PodiumCommandError(this._buildError("com_connection_failed", "Worker boot timed out")));
      }, BOOT_TIMEOUT_MS);

      /** @param {string} line */
      const onFirstLine = (line) => {
        clearTimeout(bootTimer);
        rl.off("line", onFirstLine);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          reject(new PodiumCommandError(this._buildError("com_connection_failed", `Unparseable boot line: ${line}`)));
          return;
        }
        if (msg.type === "ready") {
          this._setState("online");
          rl.on("line", (l) => this._onWorkerLine(l));
          resolve();
        } else {
          reject(
            new PodiumCommandError(
              this._buildError(msg.code || "com_connection_failed", msg.message || "Worker init failed"),
            ),
          );
        }
      };
      rl.on("line", onFirstLine);
    });

    return this._readyPromise;
  }

  /** @param {string} line */
  _onWorkerLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const pending = this._pending.get(msg.id);
    if (!pending) return;
    this._pending.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.ok) {
      pending.resolve(msg);
    } else {
      pending.reject(new PodiumCommandError(this._buildError(msg.code || "unknown", msg.message || "Command failed")));
    }
  }

  /**
   * @param {Record<string, any>} payload
   * @returns {Promise<any>}
   */
  _sendToWorker(payload) {
    const timeoutMs = COMMAND_TIMEOUTS[payload.command] ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      if (!this._worker || !this._worker.stdin?.writable) {
        reject(new PodiumCommandError(this._buildError("com_connection_failed", "Worker is not running")));
        return;
      }
      const id = randomUUID();
      const timer = setTimeout(() => {
        this._pending.delete(id);
        // PowerPoint COM calls block synchronously inside the worker -- a
        // timeout means that process is stuck and cannot be gracefully
        // cancelled, so it gets killed and replaced rather than waited on.
        this._restartWorker();
        reject(
          new PodiumCommandError(
            this._buildError("com_call_failed", `Command '${payload.command}' timed out after ${timeoutMs}ms`),
          ),
        );
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this._worker.stdin.write(JSON.stringify({ id, ...payload }) + "\n");
    });
  }

  _rejectAllPending(podiumError) {
    for (const { reject, timer } of this._pending.values()) {
      clearTimeout(timer);
      reject(new PodiumCommandError(podiumError));
    }
    this._pending.clear();
  }

  async _restartWorker() {
    this._intentionalShutdown = true;
    if (this._worker) {
      try {
        this._worker.kill("SIGKILL");
      } catch {}
    }
    this._worker = null;
    this._rl = null;
    this._readyPromise = null;
    await this._killStrayPowerPoint();
  }

  async _killStrayPowerPoint() {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/IM", "POWERPNT.EXE", "/F"], { stdio: "ignore" });
      killer.on("exit", () => resolve(undefined));
      killer.on("error", () => resolve(undefined));
    });
  }

  _startPolling() {
    this._stopPolling();
    this._pollTimer = setInterval(async () => {
      if (this._state !== "playing") {
        this._stopPolling();
        return;
      }
      try {
        const result = await this._sendToWorker({ command: "get_status" });
        if (!result.powerpointAlive) {
          this._setState("error");
          this.emit("error", this._buildError("powerpoint_crashed", "PowerPoint process is no longer running"));
          this._stopPolling();
          return;
        }
        const changed =
          result.currentSlide !== this._currentSlide || result.totalSlides !== this._totalSlides;
        this._currentSlide = result.currentSlide ?? null;
        this._totalSlides = result.totalSlides ?? null;
        if (changed) {
          this.emit("status", this.getStatus());
        }
      } catch {
        // A single missed poll tick isn't fatal by itself -- the worker's
        // own 'exit' handler (or the next command's timeout) is what
        // classifies a real crash. Swallow here to avoid spamming 'error'
        // on every poll interval while that plays out.
      }
    }, STATUS_POLL_INTERVAL_MS);
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }
}
