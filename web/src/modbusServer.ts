// 疑似PLC 用の最小 Modbus TCP サーバー（FC03 / FC04 / FC06 / FC16）
import net from "node:net";

export type RegisterTables = {
  ir: Uint16Array; // Input Registers   (PLC → TS)
  hr: Uint16Array; // Holding Registers (TS → PLC)
};

function handle(t: RegisterTables, pdu: Buffer): Buffer {
  const fc = pdu.readUInt8(0);
  const exc = (code: number) => Buffer.from([fc | 0x80, code]);

  if (fc === 0x03 || fc === 0x04) {
    const addr = pdu.readUInt16BE(1);
    const qty = pdu.readUInt16BE(3);
    const table = fc === 0x03 ? t.hr : t.ir;
    if (addr + qty > table.length) return exc(0x02);
    const out = Buffer.alloc(2 + qty * 2);
    out.writeUInt8(fc, 0);
    out.writeUInt8(qty * 2, 1);
    for (let i = 0; i < qty; i++) out.writeUInt16BE(table[addr + i], 2 + i * 2);
    return out;
  }
  if (fc === 0x06) {
    const addr = pdu.readUInt16BE(1);
    if (addr >= t.hr.length) return exc(0x02);
    t.hr[addr] = pdu.readUInt16BE(3);
    return Buffer.from(pdu.subarray(0, 5));
  }
  if (fc === 0x10) {
    const addr = pdu.readUInt16BE(1);
    const qty = pdu.readUInt16BE(3);
    if (addr + qty > t.hr.length) return exc(0x02);
    for (let i = 0; i < qty; i++) t.hr[addr + i] = pdu.readUInt16BE(6 + i * 2);
    return Buffer.from(pdu.subarray(0, 5));
  }
  return exc(0x01);
}

export function startModbusServer(t: RegisterTables, port: number, onListen?: () => void) {
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 7) {
        const total = 6 + buf.readUInt16BE(4);
        if (buf.length < total) break;
        const req = buf.subarray(0, total);
        buf = buf.subarray(total);
        const res = handle(t, req.subarray(7));
        const mbap = Buffer.from(req.subarray(0, 7));
        mbap.writeUInt16BE(res.length + 1, 4);
        sock.write(Buffer.concat([mbap, res]));
      }
    });
    sock.on("error", () => {});
  });
  server.listen(port, onListen);
  return server;
}
