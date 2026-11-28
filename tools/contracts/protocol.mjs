// The encoding rule of the board protocol, shared by the generator and the checker.
// MessagePack, maps with string keys, every non-whole number as float32.
// The keys are written in the order of the object.

import { decode, encode } from "@msgpack/msgpack";

export const ENCODING = "MessagePack, maps with string keys, floats as float32";

export function pack(msg) {
  return Buffer.from(encode(msg, { forceFloat32: true }));
}

export function unpack(bytes) {
  return decode(bytes);
}
