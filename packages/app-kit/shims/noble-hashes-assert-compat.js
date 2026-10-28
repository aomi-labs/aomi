function bool(value) {
  if (typeof value !== 'boolean') {
    throw new Error(`boolean expected, got ${typeof value}`);
  }
}

function bytes(value, ...lengths) {
  const isByteArray =
    value instanceof Uint8Array
    || ArrayBuffer.isView(value)
    || value instanceof ArrayBuffer;

  if (!isByteArray) {
    throw new Error(`Uint8Array expected, got ${typeof value}`);
  }

  const byteLength =
    value instanceof Uint8Array
      ? value.length
      : value instanceof ArrayBuffer
        ? value.byteLength
        : value.byteLength;

  if (lengths.length > 0 && !lengths.includes(byteLength)) {
    throw new Error(
      `Uint8Array expected of length ${lengths.join(" or ")}, got length=${byteLength}`,
    );
  }
}

const assertCompat = {
  bool,
  bytes,
};

export { bool, bytes };
export default assertCompat;
