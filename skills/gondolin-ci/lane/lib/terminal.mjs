// Everything the guest prints is written by the code under test, and a terminal obeys what it
// is sent: OSC 52 writes the clipboard, CSI moves the cursor over earlier lines. Keep text, line
// breaks, tabs and SGR colour; drop every other escape and control character, bare carriage
// returns included, since those let a line overwrite the one before it. SGR 8 (conceal) goes too.
// Colour can still make text hard to see, foreground on a matching background for instance; the
// sanitiser stops the terminal being driven, not text being made illegible.
//
// Works a chunk at a time. A sequence split across chunks loses its ESC and prints as plain text,
// so a split can garble colour but never pass a control through.
import { realpathSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { pathToFileURL } from "node:url";

const SGR = /\x1b\[([0-9;]{0,32})m/y;
// C0 except \t and \n, DEL, and C1, which some terminals honour even when UTF-8 encoded.
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;

/** 38 and 48 take arguments (5;n or 2;r;g;b), so an 8 among them is a colour, not conceal. */
function conceals(params) {
  const p = params.split(";");
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "38" || p[i] === "48") i += p[i + 1] === "2" ? 4 : 2;
    else if (Number(p[i]) === 8) return true;
  }
  return false;
}

/** @param {string} text @returns {string} */
export function sanitize(text) {
  const s = text.replaceAll("\r\n", "\n");
  let out = "";
  for (let i = 0; i < s.length; ) {
    if (s[i] === "\x1b") {
      SGR.lastIndex = i;
      const colour = SGR.exec(s);
      if (colour) {
        if (!conceals(colour[1])) out += colour[0];
        i += colour[0].length;
      } else {
        i += 1;
      }
    } else if (CONTROL.test(s[i])) {
      i += 1;
    } else {
      out += s[i];
      i += 1;
    }
  }
  return out;
}

/** A streaming sanitiser that decodes UTF-8 across chunk boundaries. */
export function createSanitizer() {
  const decoder = new StringDecoder("utf8");
  return {
    /** @param {Buffer | string} chunk */
    write: (chunk) => sanitize(typeof chunk === "string" ? chunk : decoder.write(chunk)),
    end: () => sanitize(decoder.end()),
  };
}

/**
 * Guest text bound for a file on the host, up to `limit` bytes. A job can print without end and the
 * laptop's disk cannot take it, so past the limit one line says the rest was dropped, and nothing
 * more is written.
 * @param {(text: string) => void} write
 * @param {number} limit
 * @returns {(text: string) => void}
 */
export function createCap(write, limit) {
  let used = 0;
  return (text) => {
    if (used > limit) return;
    used += Buffer.byteLength(text);
    write(used > limit ? `\n[guest output past ${limit} bytes dropped]\n` : text);
  };
}

// As a filter: `... | node lib/terminal.mjs`. Node resolves symlinks in import.meta.url but not in
// argv, so compare real paths.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const filter = createSanitizer();
  process.stdin.on("data", (chunk) => process.stdout.write(filter.write(chunk)));
  process.stdin.on("end", () => process.stdout.write(filter.end()));
}
