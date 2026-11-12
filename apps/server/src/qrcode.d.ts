// Minimal types for the parts of `qrcode` we use (the package ships no types).
declare module 'qrcode' {
  interface ToStringOptions {
    type?: 'svg' | 'utf8' | 'terminal';
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    margin?: number;
    width?: number;
    color?: { dark?: string; light?: string };
  }
  function toString(text: string, options?: ToStringOptions): Promise<string>;
  const QRCode: { toString: typeof toString };
  export default QRCode;
}
