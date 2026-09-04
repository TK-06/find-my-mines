/**
 * Server-authoritative turn countdown.
 *
 * The client renders whatever number it is told and never decides when a turn
 * ends — otherwise a player could stall or extend their own turn by tampering
 * with the browser. Spec: "Each player has 10 seconds per turn."
 */
export class TurnTimer {
  private handle: NodeJS.Timeout | null = null;
  private remaining = 0;

  constructor(
    private readonly onTick: (secondsLeft: number) => void,
    private readonly onExpire: () => void,
  ) {}

  get secondsLeft(): number {
    return this.remaining;
  }

  get running(): boolean {
    return this.handle !== null;
  }

  /** Restarts the countdown from `seconds`. Safe to call while already running. */
  start(seconds: number): void {
    this.stop();
    this.remaining = seconds;
    this.onTick(this.remaining);

    this.handle = setInterval(() => {
      this.remaining -= 1;
      this.onTick(this.remaining);

      if (this.remaining <= 0) {
        this.stop();
        this.onExpire();
      }
    }, 1000);
  }

  stop(): void {
    if (this.handle) {
      clearInterval(this.handle);
      this.handle = null;
    }
    this.remaining = 0;
  }
}
