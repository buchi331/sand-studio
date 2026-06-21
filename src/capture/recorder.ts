/**
 * Canvas recording + sharing.
 *
 * This is the growth engine of the app: capture a loop, share it straight to
 * social. We probe `MediaRecorder` for the best container the browser supports
 * (Safari → mp4, Chrome/Firefox → webm) and share via the Web Share API with a
 * download fallback for browsers without file sharing.
 */

export interface RecordResult {
  blob: Blob
  mime: string
  ext: string
}

export type ShareOutcome = 'shared' | 'downloaded'

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
]

/** Pick the first supported recording container, preferring mp4 for iOS. */
export function pickMime(): { mime: string; ext: string } {
  if (typeof MediaRecorder !== 'undefined') {
    for (const candidate of MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return {
          mime: candidate,
          ext: candidate.startsWith('video/mp4') ? 'mp4' : 'webm'
        }
      }
    }
  }
  return { mime: '', ext: 'webm' }
}

interface CaptureCanvas extends HTMLCanvasElement {
  captureStream(frameRate?: number): MediaStream
}

export class CanvasRecorder {
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private mime = ''
  private ext = 'webm'

  get isRecording(): boolean {
    return this.recorder?.state === 'recording'
  }

  start(canvas: HTMLCanvasElement, fps = 30): void {
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('MediaRecorder is not supported in this browser')
    }
    const picked = pickMime()
    this.mime = picked.mime
    this.ext = picked.ext

    const stream = (canvas as CaptureCanvas).captureStream(fps)
    this.chunks = []
    const recorder = new MediaRecorder(
      stream,
      this.mime ? { mimeType: this.mime } : undefined
    )
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    recorder.start()
    this.recorder = recorder
  }

  stop(): Promise<RecordResult> {
    return new Promise((resolve, reject) => {
      const recorder = this.recorder
      if (!recorder) {
        reject(new Error('Recorder is not running'))
        return
      }
      recorder.onstop = () => {
        const type = this.mime || this.chunks[0]?.type || 'video/webm'
        const blob = new Blob(this.chunks, { type })
        this.recorder = null
        this.chunks = []
        resolve({ blob, mime: type, ext: this.ext })
      }
      recorder.stop()
    })
  }
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Share the recording via the native share sheet, falling back to download. */
export async function shareVideo(
  result: RecordResult,
  baseName = 'sand-studio'
): Promise<ShareOutcome> {
  const filename = `${baseName}-${timestamp()}.${result.ext}`
  const file = new File([result.blob], filename, { type: result.mime })

  if (
    typeof navigator.share === 'function' &&
    navigator.canShare?.({ files: [file] })
  ) {
    try {
      await navigator.share({
        files: [file],
        title: '落ち砂サンドボックス',
        text: '#落ち砂サンドボックス で作った世界'
      })
      return 'shared'
    } catch (err) {
      // User dismissed the share sheet — treat as success, don't double-prompt.
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'shared'
      }
      // Otherwise fall through to the download path.
    }
  }

  downloadBlob(result.blob, filename)
  return 'downloaded'
}
