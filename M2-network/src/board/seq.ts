// Order numbers of the messages from the board (board_protocol.md section 5).
// Each message type is counted by itself. On UDP a message whose seq is not
// higher than the last one of its type is dropped. Gaps give the real loss.

export class SeqTracker {
  private readonly last = new Map<string, number>();
  private expected = 0;
  private received = 0;

  /** Forget everything: a new Hello from the board starts its numbers again. */
  reset(): void {
    this.last.clear();
    this.expected = 0;
    this.received = 0;
  }

  /** True if the message is new. A late or repeated one gives false. */
  accept(type: string, seq: number): boolean {
    const prev = this.last.get(type);
    if (prev !== undefined && seq <= prev) return false;
    this.expected += prev === undefined ? 1 : seq - prev;
    this.received += 1;
    this.last.set(type, seq);
    return true;
  }

  /** Lost share of the accepted types, in percent, since the last reset. */
  lossPct(): number {
    return this.expected === 0 ? 0 : (100 * (this.expected - this.received)) / this.expected;
  }

  counts(): { expected: number; received: number } {
    return { expected: this.expected, received: this.received };
  }
}
