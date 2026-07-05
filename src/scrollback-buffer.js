export class ScrollbackBuffer {
  constructor(maxBytes) {
    this.maxBytes = Math.max(0, Number(maxBytes) || 0);
    this.chunks = [];
    this.totalBytes = 0;
  }

  append(value) {
    if (this.maxBytes === 0) return;
    const text = String(value ?? '');
    if (!text) return;

    const bytes = Buffer.byteLength(text, 'utf8');
    this.chunks.push({ text, bytes });
    this.totalBytes += bytes;
    this.#trim();
  }

  clear() {
    this.chunks = [];
    this.totalBytes = 0;
  }

  toString() {
    return this.chunks.map((chunk) => chunk.text).join('');
  }

  get byteLength() {
    return this.totalBytes;
  }

  #trim() {
    while (this.totalBytes > this.maxBytes && this.chunks.length > 0) {
      const excess = this.totalBytes - this.maxBytes;
      const first = this.chunks[0];

      if (first.bytes <= excess) {
        this.chunks.shift();
        this.totalBytes -= first.bytes;
        continue;
      }

      const sliced = Buffer.from(first.text, 'utf8').subarray(excess).toString('utf8');
      const newBytes = Buffer.byteLength(sliced, 'utf8');
      this.chunks[0] = { text: sliced, bytes: newBytes };
      this.totalBytes -= first.bytes - newBytes;
      break;
    }
  }
}
