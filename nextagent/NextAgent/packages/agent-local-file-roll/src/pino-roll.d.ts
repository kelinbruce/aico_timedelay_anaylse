declare module 'pino-roll' {
  import type { SonicBoom } from 'sonic-boom';

  interface PinoRollOptions {
    readonly file: string;
    readonly size?: string;
    readonly frequency?: string;
    readonly dateFormat?: string;
    readonly mkdir?: boolean;
    readonly sync?: boolean;
    readonly maxLength?: number;
    readonly symlink?: boolean;
  }

  export default function build(options: PinoRollOptions): Promise<SonicBoom>;
}
