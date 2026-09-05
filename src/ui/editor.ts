import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";

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
    this.gutter = width > 2 && this.indicator ? 2 : 0;
    let lines = super.render(width - this.gutter);
    // Idle input starts at column zero. Reserve a gutter only for a working
    // spinner or scroll indicators when part of a long draft is hidden.
    if (!this.gutter && width > 2 && (this.above || this.below)) {
      this.gutter = 2;
      lines = super.render(width - this.gutter);
    }
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
            this.indicator?.renderSpinnerInBorder(1) || this.borderColor(this.above ? (this.below ? "↕" : "↑") : " ");
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
