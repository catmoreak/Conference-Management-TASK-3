export interface PresentationController {
  loadPresentation(fileUrl: string, presentationId: string): Promise<{ totalSlides: number }>;
  showCover(text: string, presentationId: string): Promise<void>;
  play(): Promise<void>;
  gotoSlide(slideNumber: number): Promise<void>;
  nextSlide(): Promise<void>;
  prevSlide(): Promise<void>;
  exitSlideshow(): Promise<void>;
  onStateChange(handler: (state: unknown) => void): void;
  onError(handler: (error: unknown) => void): void;
}
