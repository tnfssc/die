import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";

export const IDLE_PROMPT_ICON = ""; // nf-oct-chevron_right, U+F460

/** Borderless presentation; all editing, IME, paste and app shortcuts stay in Pi. */
export class CompactEditor extends CustomEditor {
  private bodyRows = 1;
  private gutter = 2;
  private above = 0;
  private below = 0;
  private indicator: Parameters<CustomEditor["setWorkingStatusIndicator"]>[0];

  override setPaddingX(_padding: number): void {
    super.setPaddingX(0); // The prompt gutter replaces horizontal editor padding.
  }

  override setWorkingStatusIndicator(indicator: Parameters<CustomEditor["setWorkingStatusIndicator"]>[0]): void {
    super.setWorkingStatusIndicator(indicator);
    this.indicator = indicator;
  }

  protected override renderTopBorder(_width: number, hidden: number): string {
    this.above = hidden;
    return "";
  }

  protected override renderBottomBorder(_width: number, hidden: number): string {
    this.below = hidden;
    return "";
  }

  override render(width: number): string[] {
    if (width < 1) return [];
    // Keep input, cursor, and autocomplete columns fixed while the idle
    // chevron is replaced by the working spinner. At two columns or fewer,
    // prioritize editable content over decoration.
    this.gutter = width > 2 ? 2 : 0;
    const lines = super.render(width - this.gutter);
    // Pi's border hooks delimit input and autocomplete. Drop only those two
    // rows, not the last row (which may belong to an autocomplete menu).
    const bottom = lines.indexOf("", 1);
    this.bodyRows = bottom - 1;
    return lines
      .filter((_, index) => index !== 0 && index !== bottom)
      .map((line, index) => {
        let prefix = " ";
        if (index === 0) {
          prefix =
            this.indicator?.renderSpinnerInBorder(1) ||
            this.borderColor(this.above ? (this.below ? "↕" : "↑") : IDLE_PROMPT_ICON);
        } else if (index === this.bodyRows - 1 && this.below) {
          prefix = this.borderColor("↓");
        }
        return truncateToWidth((this.gutter ? `${prefix} ` : "") + line, width, "");
      });
  }

  override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    return super.handleMouse({
      ...event,
      x: Math.max(0, event.x - this.gutter),
      y: event.y + (event.y < this.bodyRows ? 1 : 2),
      width: Math.max(1, event.width - this.gutter),
      height: event.height + 2,
    });
  }
}
