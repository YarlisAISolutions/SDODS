import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import type { IntegrationLogger } from './types.js';

export interface CommandResult {
  code: number;
  stderr?: string;
}

/** Runs a command; rejects when the command cannot be started (for example ENOENT). */
export type CommandRunner = (
  command: string,
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<CommandResult>;

export const defaultCommandRunner: CommandRunner = (command, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: opts.timeoutMs ?? 60_000, maxBuffer: 4 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error && typeof (error as NodeJS.ErrnoException).code === 'string') {
          reject(error);
          return;
        }
        const code = error ? ((error as { code?: number }).code ?? 1) : 0;
        resolve({ code: typeof code === 'number' ? code : 1, stderr: String(stderr) });
      },
    );
  });

export interface GifPreviewSettings {
  /** the last N seconds of the video, where the failure is */
  seconds: number;
  width: number;
  fps: number;
  /** a larger GIF is dropped rather than embedded */
  maxBytes: number;
}

export const GIF_PREVIEW_DEFAULTS: GifPreviewSettings = {
  seconds: 5,
  width: 480,
  fps: 8,
  maxBytes: 3 * 1024 * 1024,
};

/**
 * A short inline GIF of the end of a scenario's `video.webm`, made with ffmpeg when it is on PATH.
 * A missing ffmpeg, a failing conversion or an oversized result skip the preview with a debug log.
 */
export class GifPreviewer {
  private available?: Promise<boolean>;
  private readonly settings: GifPreviewSettings;

  constructor(
    private readonly runner: CommandRunner = defaultCommandRunner,
    settings: Partial<GifPreviewSettings> = {},
    private readonly ffmpeg = 'ffmpeg',
  ) {
    this.settings = { ...GIF_PREVIEW_DEFAULTS, ...settings };
  }

  get seconds(): number {
    return this.settings.seconds;
  }

  /** ffmpeg arguments for one preview (exported for the docs and tests). */
  args(videoPath: string, outPath: string): string[] {
    const { seconds, width, fps } = this.settings;
    return [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-sseof',
      `-${seconds}`,
      '-i',
      videoPath,
      '-vf',
      `fps=${fps},scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse`,
      '-loop',
      '0',
      outPath,
    ];
  }

  async make(
    videoPath: string,
    outPath: string,
    logger?: IntegrationLogger,
  ): Promise<string | null> {
    if (!(await this.isAvailable())) {
      logger?.debug('github evidence: ffmpeg not found on PATH, skipping the GIF preview');
      return null;
    }
    try {
      const res = await this.runner(this.ffmpeg, this.args(videoPath, outPath), {
        timeoutMs: 60_000,
      });
      if (res.code !== 0 || !existsSync(outPath)) {
        logger?.debug(
          `github evidence: ffmpeg could not make a GIF preview of ${videoPath} (exit ${res.code}): ${(res.stderr ?? '').trim().slice(0, 300)}`,
        );
        return null;
      }
      const size = statSync(outPath).size;
      if (size > this.settings.maxBytes) {
        logger?.debug(
          `github evidence: GIF preview of ${videoPath} is ${size} bytes, over ${this.settings.maxBytes}; skipped`,
        );
        return null;
      }
      return outPath;
    } catch (e) {
      logger?.debug(`github evidence: GIF preview failed: ${(e as Error).message}`);
      return null;
    }
  }

  private isAvailable(): Promise<boolean> {
    this.available ??= this.runner(this.ffmpeg, ['-version'], { timeoutMs: 10_000 }).then(
      (r) => r.code === 0,
      () => false,
    );
    return this.available;
  }
}
