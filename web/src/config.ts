// エレベータのレジスタマップ。codesys/src/PRG_Elevator.st と一致させること

export const elevatorConfig = {
  host: process.env.MB_HOST ?? "127.0.0.1",
  port: Number(process.env.MB_PORT ?? 502),
  unitId: Number(process.env.MB_UNIT ?? 1),
  webPort: Number(process.env.WEB_PORT ?? 3001),
  intervalMs: 100, // 画面のアニメーションが滑らかに見えるよう、デバッグ画面より短め
};

// Input Registers（PLC → TS）
export const IR = {
  state: 0,
  position: 1, // 位置 ×100（1.00F → 100）
  floor: 2,
  direction: 3,
  doorPct: 4,
  carCalls: 5, // bit0 = 1F
  hallCalls: 6,
  persons: 7,
  loadKg: 8,
  flags: 9, // bit0 超過 / bit1 警報中 / bit2 扉全開 / bit3 扉全閉 / bit4 移動中
  ackSeq: 10,
  maxLoadKg: 11,
  maxPersons: 12,
  floorCount: 13,
  heartbeat: 14,
} as const;
export const IR_COUNT = 20;

// Holding Registers（TS → PLC）
export const HR = {
  cmdCode: 0,
  cmdFloor: 1,
  cmdSeq: 2, // 指令の通し番号。種類・階と一緒に FC16 で書く
  persons: 3,
  loadKg: 4,
} as const;
export const HR_COUNT = 10;

// E_ElevCmd
export const Cmd = { None: 0, CarCall: 1, HallCall: 2, DoorOpen: 3, DoorClose: 4 } as const;

// E_ElevState
export const State = {
  Idle: 0,
  DoorOpening: 1,
  DoorOpen: 2,
  DoorClosing: 3,
  Moving: 4,
  Overload: 5,
} as const;

// E_Direction
export const Direction = { Stop: 0, Up: 1, Down: 2 } as const;
