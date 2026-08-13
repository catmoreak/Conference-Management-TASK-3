import type { PresentationController } from "./PresentationController";

interface PodiumCommandResult {
  success: boolean;
  status?: { totalSlides?: number | null };
  error?: string;
}

interface ElectronPodiumBridge {
  runPodiumCommand(cmd: Record<string, unknown>): Promise<PodiumCommandResult>;
  onPodiumStatus(callback: (status: unknown) => void): () => void;
  onPodiumError(callback: (error: unknown) => void): () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronPodiumBridge & Record<string, unknown>;
  }
}

/**
 * Concrete PresentationController that delegates to the Electron main
 * process's PptxController (COM-driven PowerPoint automation) via the
 * podium-command IPC bridge exposed in preload.js.
 */
export class IpcPresentationController implements PresentationController {
  private readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  private async run(cmd: Record<string, unknown>): Promise<PodiumCommandResult> {
    const bridge = window.electronAPI;
    if (!bridge?.runPodiumCommand) {
      throw new Error("podium-command IPC bridge is not available");
    }
    const result = await bridge.runPodiumCommand({ sessionId: this.sessionId, ...cmd });
    if (!result.success) {
      throw new Error(result.error ?? "podium command failed");
    }
    return result;
  }

  async loadPresentation(fileUrl: string, presentationId: string): Promise<{ totalSlides: number }> {
    const result = await this.run({ type: "load_presentation", fileUrl, presentationId });
    return { totalSlides: result.status?.totalSlides ?? 0 };
  }

  async showCover(text: string, presentationId: string): Promise<void> {
    await this.run({ type: "show_cover", text, presentationId });
  }

  async play(): Promise<void> {
    await this.run({ type: "play" });
  }

  async gotoSlide(slideNumber: number): Promise<void> {
    await this.run({ type: "goto_slide", slideNumber });
  }

  async nextSlide(): Promise<void> {
    await this.run({ type: "next_slide" });
  }

  async prevSlide(): Promise<void> {
    await this.run({ type: "prev_slide" });
  }

  async exitSlideshow(): Promise<void> {
    await this.run({ type: "exit_slideshow" });
  }

  onStateChange(handler: (state: unknown) => void): void {
    window.electronAPI?.onPodiumStatus(handler);
  }

  onError(handler: (error: unknown) => void): void {
    window.electronAPI?.onPodiumError(handler);
  }
}
