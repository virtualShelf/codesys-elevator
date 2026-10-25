// エレベータの疑似PLC：CODESYS なしで操作画面を試すための Modbus TCP サーバー
// codesys/src/ の ST と同じロジック（logic.ts）を 10ms 周期で回す
//   node src/sim.ts               → :502
//   MB_PORT=1502 node src/sim.ts  → 502 が使えない環境用
import { startModbusServer } from "./modbusServer.ts";
import { ElevatorPlc } from "./logic.ts";
import { elevatorConfig } from "./config.ts";

const CYCLE_MS = 10;
const plc = new ElevatorPlc();
let last = performance.now();

setInterval(() => {
  const now = performance.now();
  plc.cycle(now - last);
  last = now;
}, CYCLE_MS);

startModbusServer({ ir: plc.ir, hr: plc.hr }, elevatorConfig.port, () =>
  console.log(`Elevator sim PLC listening on :${elevatorConfig.port}`));
